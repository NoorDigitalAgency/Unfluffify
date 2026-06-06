function stripJsoncComments(source) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      if (index < source.length) {
        output += "\n";
      }
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length) {
        if (source[index] === "\n") {
          output += "\n";
        }
        if (source[index] === "*" && source[index + 1] === "/") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    output += char;
  }

  return output;
}

function stripTrailingCommas(source) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < source.length && /\s/.test(source[lookahead])) {
        lookahead += 1;
      }
      if (source[lookahead] === "}" || source[lookahead] === "]") {
        continue;
      }
    }

    output += char;
  }

  return output;
}

export function parseJsonc(source, sourceLabel = "JSONC source") {
  try {
    return JSON.parse(stripTrailingCommas(stripJsoncComments(String(source))));
  } catch {
    throw new Error(`Invalid JSONC in ${sourceLabel}`);
  }
}
