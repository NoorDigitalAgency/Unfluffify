using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;

/// <summary>
/// Stateless extractor that uses only:
/// - inclusionCssSelectors: explicit include overrides
/// - exclusionCssSelectors: exclusion boundaries
/// - fullHtml: source document
///
/// Rules:
/// 1. Elements matched by exclusion selectors exclude their subtree text.
/// 2. Elements matched by inclusion selectors are explicitly included even if
///    hidden or inside excluded ancestors.
/// 3. Textual elements in neither list are implicitly included.
/// </summary>
public sealed class ContentExtractor
{
    private static readonly Regex InlineWhitespaceRegex = new("[ \\t\\f\\v]+", RegexOptions.Compiled);
    private static readonly Regex AroundNewlineRegex = new(" *\\n *", RegexOptions.Compiled);
    private static readonly Regex ExcessNewlinesRegex = new("\\n{3,}", RegexOptions.Compiled);

    public static string[] ExtractContent(
        string fullHtml,
        string exclusionCssSelectors,
        string inclusionCssSelectors)
    {
        if (string.IsNullOrWhiteSpace(fullHtml))
        {
            return Array.Empty<string>();
        }

        var parser = new HtmlParser();
        var document = parser.ParseDocument(fullHtml);
        if (document.Body is null)
        {
            return Array.Empty<string>();
        }

        var includeSelectors = ParseSelectorList(inclusionCssSelectors);
        var excludeSelectors = ParseSelectorList(exclusionCssSelectors);

        var excludedElements = CollectSelectorElements(document, excludeSelectors);
        var explicitIncludedElementsRaw = CollectSelectorElements(document, includeSelectors);
        // If an element is both included and excluded, exclusion wins for that exact element.
        var explicitIncludedElements = new HashSet<IElement>(
            explicitIncludedElementsRaw.Where(el => !excludedElements.Contains(el))
        );
        var orderIndex = BuildDocumentOrderIndex(document.DocumentElement ?? document.Body);

        var implicitRoots = CollectImplicitRoots(
            orderIndex,
            explicitIncludedElements,
            excludedElements);

        var allRoots = CollapseRootsPreservingExplicit(
            explicitIncludedElements.Concat(implicitRoots),
            explicitIncludedElements,
            orderIndex);

        if (allRoots.Count == 0)
        {
            return Array.Empty<string>();
        }

        var rootSet = new HashSet<IElement>(allRoots);
        var rows = new List<(int Order, string Text)>();

        foreach (var root in allRoots)
        {
            var rootIsExplicit = explicitIncludedElements.Contains(root);
            var explicitBoundary = rootIsExplicit ? root : null;

            // Non-explicit roots do not survive hidden/excluded boundaries.
            if (!rootIsExplicit)
            {
                if (IsHiddenByAncestor(root))
                {
                    continue;
                }

                if (IsBlockedByExclusion(root, excludedElements, explicitIncludedElements))
                {
                    continue;
                }
            }

            var text = ExtractTextForRoot(
                root,
                excludedElements,
                explicitIncludedElements,
                rootSet,
                explicitBoundary);

            if (string.IsNullOrWhiteSpace(text))
            {
                continue;
            }

            rows.Add((GetOrder(orderIndex, root), text));
        }

        return rows
            .OrderBy(row => row.Order)
            .Select(row => row.Text)
            .ToArray();
    }

    private static HashSet<IElement> CollectSelectorElements(
        IDocument document,
        IReadOnlyList<string> selectors)
    {
        var elements = new HashSet<IElement>();

        foreach (var selector in selectors)
        {
            if (string.IsNullOrWhiteSpace(selector))
            {
                continue;
            }

            var matchedAny = false;
            foreach (var candidate in BuildSelectorCandidates(selector))
            {
                List<IElement> matches;
                try
                {
                    matches = document.QuerySelectorAll(candidate).OfType<IElement>().ToList();
                }
                catch
                {
                    // Ignore invalid selectors.
                    continue;
                }

                if (matches.Count == 0)
                {
                    continue;
                }

                foreach (var el in matches)
                {
                    elements.Add(el);
                }

                matchedAny = true;
                break;
            }

            if (!matchedAny)
            {
                continue;
            }
        }

        return elements;
    }

    private static List<string> BuildSelectorCandidates(string selector)
    {
        var candidates = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        static bool IsEmpty(string value) => string.IsNullOrWhiteSpace(value);

        void Add(string value)
        {
            if (IsEmpty(value))
            {
                return;
            }

            var trimmed = value.Trim();
            if (trimmed.Length == 0 || !seen.Add(trimmed))
            {
                return;
            }

            candidates.Add(trimmed);
        }

        var initial = selector.Trim();
        Add(initial);

        var idRelaxedVariants = new List<string>();
        var currentIdRelaxed = initial;
        while (true)
        {
            var next = RemoveFirstIdSelector(currentIdRelaxed);
            if (string.Equals(next, currentIdRelaxed, StringComparison.Ordinal))
            {
                break;
            }

            Add(next);
            idRelaxedVariants.Add(next);
            currentIdRelaxed = next;
        }

        var nthBases = new List<string> { initial };
        nthBases.AddRange(idRelaxedVariants);
        foreach (var nthBase in nthBases)
        {
            var currentNthRelaxed = nthBase;
            while (true)
            {
                var next = RemoveFirstNthPseudoSelector(currentNthRelaxed);
                if (string.Equals(next, currentNthRelaxed, StringComparison.Ordinal))
                {
                    break;
                }

                Add(next);
                currentNthRelaxed = next;
            }
        }

        return candidates;
    }

    private static string RemoveFirstIdSelector(string selector)
    {
        if (string.IsNullOrEmpty(selector))
        {
            return selector;
        }

        var builder = new StringBuilder(selector.Length);
        char quote = '\0';
        var bracketDepth = 0;
        var removed = false;

        for (var i = 0; i < selector.Length; i++)
        {
            var ch = selector[i];

            if (quote != '\0')
            {
                builder.Append(ch);
                if (ch == quote && (i == 0 || selector[i - 1] != '\\'))
                {
                    quote = '\0';
                }

                continue;
            }

            if (ch == '"' || ch == '\'')
            {
                quote = ch;
                builder.Append(ch);
                continue;
            }

            if (ch == '[')
            {
                bracketDepth++;
                builder.Append(ch);
                continue;
            }

            if (ch == ']')
            {
                bracketDepth = Math.Max(0, bracketDepth - 1);
                builder.Append(ch);
                continue;
            }

            if (!removed && bracketDepth == 0 && ch == '#')
            {
                var start = i;
                var end = i + 1;
                while (end < selector.Length &&
                       (char.IsLetterOrDigit(selector[end]) || selector[end] == '-' || selector[end] == '_'))
                {
                    end++;
                }

                if (end > start + 1)
                {
                    removed = true;
                    i = end - 1;
                    continue;
                }
            }

            builder.Append(ch);
        }

        return builder.ToString();
    }

    private static string RemoveFirstNthPseudoSelector(string selector)
    {
        if (string.IsNullOrEmpty(selector))
        {
            return selector;
        }

        var lower = selector.ToLowerInvariant();
        var firstNthOfType = lower.IndexOf(":nth-of-type(", StringComparison.Ordinal);
        var firstNthChild = lower.IndexOf(":nth-child(", StringComparison.Ordinal);

        var start = -1;
        if (firstNthOfType >= 0 && firstNthChild >= 0)
        {
            start = Math.Min(firstNthOfType, firstNthChild);
        }
        else if (firstNthOfType >= 0)
        {
            start = firstNthOfType;
        }
        else if (firstNthChild >= 0)
        {
            start = firstNthChild;
        }

        if (start < 0)
        {
            return selector;
        }

        var openParen = selector.IndexOf('(', start);
        if (openParen < 0)
        {
            return selector;
        }

        var depth = 1;
        char quote = '\0';
        var index = openParen + 1;

        while (index < selector.Length && depth > 0)
        {
            var ch = selector[index];
            if (quote != '\0')
            {
                if (ch == quote && selector[index - 1] != '\\')
                {
                    quote = '\0';
                }

                index++;
                continue;
            }

            if (ch == '"' || ch == '\'')
            {
                quote = ch;
                index++;
                continue;
            }

            if (ch == '(')
            {
                depth++;
            }
            else if (ch == ')')
            {
                depth--;
            }

            index++;
        }

        if (depth != 0)
        {
            return selector;
        }

        return string.Concat(selector.AsSpan(0, start), selector.AsSpan(index));
    }

    private static List<IElement> CollectImplicitRoots(
        IReadOnlyDictionary<IElement, int> orderIndex,
        HashSet<IElement> explicitIncludedElements,
        HashSet<IElement> excludedElements)
    {
        var orderedElements = orderIndex
            .OrderBy(pair => pair.Value)
            .Select(pair => pair.Key);

        var roots = new List<IElement>();
        foreach (var element in orderedElements)
        {
            if (IsTextSuppressedTag(element))
            {
                continue;
            }

            if (!HasDirectText(element))
            {
                continue;
            }

            // Skip explicit roots themselves here; descendants are evaluated normally.
            if (explicitIncludedElements.Contains(element))
            {
                continue;
            }

            if (IsHiddenByAncestor(element))
            {
                continue;
            }

            if (IsBlockedByExclusion(element, excludedElements, explicitIncludedElements))
            {
                continue;
            }

            roots.Add(element);
        }

        return roots;
    }

    private static List<IElement> CollapseRootsPreservingExplicit(
        IEnumerable<IElement> candidates,
        HashSet<IElement> explicitIncludedElements,
        IReadOnlyDictionary<IElement, int> orderIndex)
    {
        var list = candidates
            .Where(el => el is not null)
            .Distinct()
            .ToList();

        list.Sort((left, right) =>
        {
            var depthDiff = GetElementDepth(left) - GetElementDepth(right);
            if (depthDiff != 0)
            {
                return depthDiff;
            }

            return CompareDocumentOrder(left, right, orderIndex);
        });

        var kept = new List<IElement>();
        var keptSet = new HashSet<IElement>();

        foreach (var candidate in list)
        {
            if (explicitIncludedElements.Contains(candidate))
            {
                if (keptSet.Add(candidate))
                {
                    kept.Add(candidate);
                }

                continue;
            }

            var hasKeptAncestor = kept.Any(ancestor => ancestor.Contains(candidate));
            if (!hasKeptAncestor)
            {
                kept.Add(candidate);
                keptSet.Add(candidate);
            }
        }

        kept.Sort((left, right) => CompareDocumentOrder(left, right, orderIndex));
        return kept;
    }

    private static string ExtractTextForRoot(
        IElement root,
        HashSet<IElement> excludedElements,
        HashSet<IElement> explicitIncludedElements,
        HashSet<IElement> allRoots,
        IElement? explicitBoundary)
    {
        var chunks = new List<string>();
        var stack = new Stack<INode>();
        stack.Push(root);

        while (stack.Count > 0)
        {
            var node = stack.Pop();
            if (node.NodeType == NodeType.Text)
            {
                var parentElement = node.Parent as IElement;
                if (parentElement is not null)
                {
                    if (IsHiddenByAncestor(parentElement, explicitBoundary))
                    {
                        continue;
                    }

                    if (IsBlockedByExclusion(
                        parentElement,
                        excludedElements,
                        explicitIncludedElements,
                        explicitBoundary))
                    {
                        continue;
                    }
                }

                var text = (node.TextContent ?? string.Empty).Replace('\u00A0', ' ');
                if (!string.IsNullOrWhiteSpace(text))
                {
                    chunks.Add(text);
                }

                continue;
            }

            if (node is not IElement element)
            {
                continue;
            }

            if (element.TagName.Equals("BR", StringComparison.OrdinalIgnoreCase) ||
                element.TagName.Equals("WBR", StringComparison.OrdinalIgnoreCase))
            {
                chunks.Add("\n");
                continue;
            }

            if (!ReferenceEquals(element, root))
            {
                // Let separate roots render their own block to avoid duplicates.
                if (allRoots.Contains(element))
                {
                    continue;
                }

                if (IsHiddenByAncestor(element, explicitBoundary))
                {
                    continue;
                }

                if (IsBlockedByExclusion(
                    element,
                    excludedElements,
                    explicitIncludedElements,
                    explicitBoundary))
                {
                    continue;
                }
            }

            if (IsTextSuppressedTag(element))
            {
                continue;
            }

            for (var i = element.ChildNodes.Length - 1; i >= 0; i--)
            {
                stack.Push(element.ChildNodes[i]);
            }
        }

        var combined = string.Concat(chunks);
        combined = combined.Replace("\r", string.Empty);
        combined = InlineWhitespaceRegex.Replace(combined, " ");
        combined = AroundNewlineRegex.Replace(combined, "\n");
        combined = ExcessNewlinesRegex.Replace(combined, "\n\n");
        return combined.Trim();
    }

    private static bool IsBlockedByExclusion(
        IElement element,
        HashSet<IElement> excludedElements,
        HashSet<IElement> explicitIncludedElements,
        IElement? explicitBoundary = null)
    {
        // Only explicitly included elements themselves can bypass exclusion.
        if (explicitIncludedElements.Contains(element))
        {
            return false;
        }

        for (IElement? current = element; current is not null; current = current.ParentElement)
        {
            if (excludedElements.Contains(current))
            {
                if (explicitBoundary is not null &&
                    (ReferenceEquals(current, explicitBoundary) || current.Contains(explicitBoundary)))
                {
                    continue;
                }

                return true;
            }
        }

        return false;
    }

    private static bool HasDirectText(IElement element)
    {
        foreach (var node in element.ChildNodes)
        {
            if (node.NodeType == NodeType.Text && !string.IsNullOrWhiteSpace(node.TextContent))
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsTextSuppressedTag(IElement element)
    {
        var tag = element.TagName;
        return
            tag.Equals("SCRIPT", StringComparison.OrdinalIgnoreCase) ||
            tag.Equals("STYLE", StringComparison.OrdinalIgnoreCase) ||
            tag.Equals("NOSCRIPT", StringComparison.OrdinalIgnoreCase) ||
            tag.Equals("TEMPLATE", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsHiddenByAncestor(IElement element, IElement? explicitBoundary = null)
    {
        for (IElement? current = element; current is not null; current = current.ParentElement)
        {
            if (IsHiddenSelf(current))
            {
                if (explicitBoundary is not null &&
                    (ReferenceEquals(current, explicitBoundary) || current.Contains(explicitBoundary)))
                {
                    continue;
                }

                return true;
            }
        }

        return false;
    }

    private static bool IsHiddenSelf(IElement element)
    {
        if (element.HasAttribute("hidden"))
        {
            return true;
        }

        var ariaHidden = (element.GetAttribute("aria-hidden") ?? string.Empty).Trim();
        if (ariaHidden.Equals("true", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var style = (element.GetAttribute("style") ?? string.Empty).ToLowerInvariant();
        if (style.Length == 0)
        {
            return false;
        }

        // Inline style only. No computed CSS in pure backend HTML parsing.
        var compact = style.Replace(" ", string.Empty);
        if (compact.Contains("display:none", StringComparison.Ordinal) ||
            compact.Contains("visibility:hidden", StringComparison.Ordinal) ||
            compact.Contains("visibility:collapse", StringComparison.Ordinal))
        {
            return true;
        }

        return false;
    }

    private static int GetElementDepth(IElement element)
    {
        var depth = 0;
        for (IElement? current = element; current?.ParentElement is not null; current = current.ParentElement)
        {
            depth++;
        }

        return depth;
    }

    private static int CompareDocumentOrder(
        IElement left,
        IElement right,
        IReadOnlyDictionary<IElement, int> orderIndex)
    {
        return GetOrder(orderIndex, left).CompareTo(GetOrder(orderIndex, right));
    }

    private static int GetOrder(IReadOnlyDictionary<IElement, int> orderIndex, IElement element)
    {
        return orderIndex.TryGetValue(element, out var order) ? order : int.MaxValue;
    }

    private static Dictionary<IElement, int> BuildDocumentOrderIndex(IElement root)
    {
        var index = new Dictionary<IElement, int>();
        var stack = new Stack<IElement>();
        stack.Push(root);
        var next = 0;

        while (stack.Count > 0)
        {
            var element = stack.Pop();
            if (!index.ContainsKey(element))
            {
                index[element] = next++;
            }

            for (var i = element.Children.Length - 1; i >= 0; i--)
            {
                if (element.Children[i] is IElement child)
                {
                    stack.Push(child);
                }
            }
        }

        return index;
    }

    private static List<string> ParseSelectorList(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new List<string>();
        }

        var trimmed = raw.Trim();
        List<string> parsed;

        if (trimmed.StartsWith("[", StringComparison.Ordinal))
        {
            try
            {
                parsed = JsonSerializer.Deserialize<List<string>>(trimmed) ?? new List<string>();
            }
            catch
            {
                parsed = SplitCssSelectorList(trimmed).ToList();
            }
        }
        else
        {
            parsed = SplitCssSelectorList(trimmed).ToList();
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var results = new List<string>();
        foreach (var selector in parsed)
        {
            var value = (selector ?? string.Empty).Trim();
            if (value.Length == 0 || !seen.Add(value))
            {
                continue;
            }

            results.Add(value);
        }

        return results;
    }

    private static IEnumerable<string> SplitCssSelectorList(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            yield break;
        }

        var buffer = new StringBuilder();
        var bracketDepth = 0;
        var parenDepth = 0;
        char quote = '\0';

        for (var i = 0; i < value.Length; i++)
        {
            var ch = value[i];

            if (quote != '\0')
            {
                buffer.Append(ch);
                if (ch == quote && (i == 0 || value[i - 1] != '\\'))
                {
                    quote = '\0';
                }

                continue;
            }

            if (ch == '"' || ch == '\'')
            {
                quote = ch;
                buffer.Append(ch);
                continue;
            }

            if (ch == '[')
            {
                bracketDepth++;
                buffer.Append(ch);
                continue;
            }

            if (ch == ']')
            {
                bracketDepth = Math.Max(0, bracketDepth - 1);
                buffer.Append(ch);
                continue;
            }

            if (ch == '(')
            {
                parenDepth++;
                buffer.Append(ch);
                continue;
            }

            if (ch == ')')
            {
                parenDepth = Math.Max(0, parenDepth - 1);
                buffer.Append(ch);
                continue;
            }

            var isSeparator = (ch == ',' || ch == '\n' || ch == ';') &&
                              bracketDepth == 0 &&
                              parenDepth == 0;
            if (isSeparator)
            {
                var part = buffer.ToString().Trim();
                if (part.Length > 0)
                {
                    yield return part;
                }

                buffer.Clear();
                continue;
            }

            buffer.Append(ch);
        }

        var tail = buffer.ToString().Trim();
        if (tail.Length > 0)
        {
            yield return tail;
        }
    }
}
