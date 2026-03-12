using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;

/// <summary>
/// Stateless extractor that returns preview-style text blocks from HTML using only:
/// - inclusion CSS selectors
/// - exclusion CSS selectors
/// </summary>
public sealed class AngleSharpPreviewContentExtractor
{
    private static readonly Regex InlineWhitespaceRegex = new("[ \\t\\f\\v]+", RegexOptions.Compiled);
    private static readonly Regex AroundNewlineRegex = new(" *\\n *", RegexOptions.Compiled);
    private static readonly Regex ExcessNewlinesRegex = new("\\n{3,}", RegexOptions.Compiled);

    public string[] ExtractContent(
        string fullHtml,
        string exclusionCssSelectors,
        string inclusionCssSelectors)
    {
        if (string.IsNullOrWhiteSpace(fullHtml))
        {
            return Array.Empty<string>();
        }

        var includeSelectors = ParseSelectorList(inclusionCssSelectors);
        if (includeSelectors.Count == 0)
        {
            return Array.Empty<string>();
        }

        var excludeSelectors = ParseSelectorList(exclusionCssSelectors);

        var parser = new HtmlParser();
        var document = parser.ParseDocument(fullHtml);
        if (document.Body is null)
        {
            return Array.Empty<string>();
        }

        var excludedElements = CollectSelectorElements(document, excludeSelectors);
        var includedElements = CollectSelectorElements(document, includeSelectors);
        if (includedElements.Count == 0)
        {
            return Array.Empty<string>();
        }

        var orderIndex = BuildDocumentOrderIndex(document.DocumentElement ?? document.Body);
        var includeRoots = CollapseElementsByNesting(includedElements, orderIndex);

        var rows = new List<(int Order, string Text)>();
        foreach (var root in includeRoots)
        {
            if (IsInsideExcluded(root, excludedElements))
            {
                continue;
            }

            var text = ExtractPreviewText(root, excludedElements);
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

            try
            {
                foreach (var element in document.QuerySelectorAll(selector).OfType<IElement>())
                {
                    elements.Add(element);
                }
            }
            catch
            {
                // Ignore invalid selectors.
            }
        }

        return elements;
    }

    private static List<IElement> CollapseElementsByNesting(
        IEnumerable<IElement> elements,
        IReadOnlyDictionary<IElement, int> orderIndex)
    {
        var list = elements
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
        foreach (var candidate in list)
        {
            var hasKeptAncestor = kept.Any(ancestor => ancestor.Contains(candidate));
            if (!hasKeptAncestor)
            {
                kept.Add(candidate);
            }
        }

        kept.Sort((left, right) => CompareDocumentOrder(left, right, orderIndex));
        return kept;
    }

    private static string ExtractPreviewText(
        IElement root,
        HashSet<IElement> excludedElements)
    {
        var chunks = new List<string>();
        var stack = new Stack<INode>();
        stack.Push(root);

        while (stack.Count > 0)
        {
            var node = stack.Pop();
            if (node.NodeType == NodeType.Text)
            {
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

            if (!ReferenceEquals(element, root) && IsInsideExcluded(element, excludedElements))
            {
                continue;
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

    private static bool IsInsideExcluded(IElement element, HashSet<IElement> excludedElements)
    {
        for (IElement? current = element; current is not null; current = current.ParentElement)
        {
            if (excludedElements.Contains(current))
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
