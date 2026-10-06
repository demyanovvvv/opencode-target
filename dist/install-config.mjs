// OpenCode Target installer helper — generated from install-config.mjs. Do not edit.
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value2 = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value2 = value2 * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value2 = value2 * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value2 = value2 * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value2 = -1;
    }
    return value2;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += "\n";
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "	";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += "\n";
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      // tokens: []{}:,
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      // strings
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      // comments
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      // numbers
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      // found a minus, followed by a number so
      // we fall through to proceed with scanning
      // numbers
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      // literals and unknown symbols
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
var init_scanner = __esm({
  "node_modules/jsonc-parser/lib/esm/impl/scanner.js"() {
    "use strict";
    (function(CharacterCodes2) {
      CharacterCodes2[CharacterCodes2["lineFeed"] = 10] = "lineFeed";
      CharacterCodes2[CharacterCodes2["carriageReturn"] = 13] = "carriageReturn";
      CharacterCodes2[CharacterCodes2["space"] = 32] = "space";
      CharacterCodes2[CharacterCodes2["_0"] = 48] = "_0";
      CharacterCodes2[CharacterCodes2["_1"] = 49] = "_1";
      CharacterCodes2[CharacterCodes2["_2"] = 50] = "_2";
      CharacterCodes2[CharacterCodes2["_3"] = 51] = "_3";
      CharacterCodes2[CharacterCodes2["_4"] = 52] = "_4";
      CharacterCodes2[CharacterCodes2["_5"] = 53] = "_5";
      CharacterCodes2[CharacterCodes2["_6"] = 54] = "_6";
      CharacterCodes2[CharacterCodes2["_7"] = 55] = "_7";
      CharacterCodes2[CharacterCodes2["_8"] = 56] = "_8";
      CharacterCodes2[CharacterCodes2["_9"] = 57] = "_9";
      CharacterCodes2[CharacterCodes2["a"] = 97] = "a";
      CharacterCodes2[CharacterCodes2["b"] = 98] = "b";
      CharacterCodes2[CharacterCodes2["c"] = 99] = "c";
      CharacterCodes2[CharacterCodes2["d"] = 100] = "d";
      CharacterCodes2[CharacterCodes2["e"] = 101] = "e";
      CharacterCodes2[CharacterCodes2["f"] = 102] = "f";
      CharacterCodes2[CharacterCodes2["g"] = 103] = "g";
      CharacterCodes2[CharacterCodes2["h"] = 104] = "h";
      CharacterCodes2[CharacterCodes2["i"] = 105] = "i";
      CharacterCodes2[CharacterCodes2["j"] = 106] = "j";
      CharacterCodes2[CharacterCodes2["k"] = 107] = "k";
      CharacterCodes2[CharacterCodes2["l"] = 108] = "l";
      CharacterCodes2[CharacterCodes2["m"] = 109] = "m";
      CharacterCodes2[CharacterCodes2["n"] = 110] = "n";
      CharacterCodes2[CharacterCodes2["o"] = 111] = "o";
      CharacterCodes2[CharacterCodes2["p"] = 112] = "p";
      CharacterCodes2[CharacterCodes2["q"] = 113] = "q";
      CharacterCodes2[CharacterCodes2["r"] = 114] = "r";
      CharacterCodes2[CharacterCodes2["s"] = 115] = "s";
      CharacterCodes2[CharacterCodes2["t"] = 116] = "t";
      CharacterCodes2[CharacterCodes2["u"] = 117] = "u";
      CharacterCodes2[CharacterCodes2["v"] = 118] = "v";
      CharacterCodes2[CharacterCodes2["w"] = 119] = "w";
      CharacterCodes2[CharacterCodes2["x"] = 120] = "x";
      CharacterCodes2[CharacterCodes2["y"] = 121] = "y";
      CharacterCodes2[CharacterCodes2["z"] = 122] = "z";
      CharacterCodes2[CharacterCodes2["A"] = 65] = "A";
      CharacterCodes2[CharacterCodes2["B"] = 66] = "B";
      CharacterCodes2[CharacterCodes2["C"] = 67] = "C";
      CharacterCodes2[CharacterCodes2["D"] = 68] = "D";
      CharacterCodes2[CharacterCodes2["E"] = 69] = "E";
      CharacterCodes2[CharacterCodes2["F"] = 70] = "F";
      CharacterCodes2[CharacterCodes2["G"] = 71] = "G";
      CharacterCodes2[CharacterCodes2["H"] = 72] = "H";
      CharacterCodes2[CharacterCodes2["I"] = 73] = "I";
      CharacterCodes2[CharacterCodes2["J"] = 74] = "J";
      CharacterCodes2[CharacterCodes2["K"] = 75] = "K";
      CharacterCodes2[CharacterCodes2["L"] = 76] = "L";
      CharacterCodes2[CharacterCodes2["M"] = 77] = "M";
      CharacterCodes2[CharacterCodes2["N"] = 78] = "N";
      CharacterCodes2[CharacterCodes2["O"] = 79] = "O";
      CharacterCodes2[CharacterCodes2["P"] = 80] = "P";
      CharacterCodes2[CharacterCodes2["Q"] = 81] = "Q";
      CharacterCodes2[CharacterCodes2["R"] = 82] = "R";
      CharacterCodes2[CharacterCodes2["S"] = 83] = "S";
      CharacterCodes2[CharacterCodes2["T"] = 84] = "T";
      CharacterCodes2[CharacterCodes2["U"] = 85] = "U";
      CharacterCodes2[CharacterCodes2["V"] = 86] = "V";
      CharacterCodes2[CharacterCodes2["W"] = 87] = "W";
      CharacterCodes2[CharacterCodes2["X"] = 88] = "X";
      CharacterCodes2[CharacterCodes2["Y"] = 89] = "Y";
      CharacterCodes2[CharacterCodes2["Z"] = 90] = "Z";
      CharacterCodes2[CharacterCodes2["asterisk"] = 42] = "asterisk";
      CharacterCodes2[CharacterCodes2["backslash"] = 92] = "backslash";
      CharacterCodes2[CharacterCodes2["closeBrace"] = 125] = "closeBrace";
      CharacterCodes2[CharacterCodes2["closeBracket"] = 93] = "closeBracket";
      CharacterCodes2[CharacterCodes2["colon"] = 58] = "colon";
      CharacterCodes2[CharacterCodes2["comma"] = 44] = "comma";
      CharacterCodes2[CharacterCodes2["dot"] = 46] = "dot";
      CharacterCodes2[CharacterCodes2["doubleQuote"] = 34] = "doubleQuote";
      CharacterCodes2[CharacterCodes2["minus"] = 45] = "minus";
      CharacterCodes2[CharacterCodes2["openBrace"] = 123] = "openBrace";
      CharacterCodes2[CharacterCodes2["openBracket"] = 91] = "openBracket";
      CharacterCodes2[CharacterCodes2["plus"] = 43] = "plus";
      CharacterCodes2[CharacterCodes2["slash"] = 47] = "slash";
      CharacterCodes2[CharacterCodes2["formFeed"] = 12] = "formFeed";
      CharacterCodes2[CharacterCodes2["tab"] = 9] = "tab";
    })(CharacterCodes || (CharacterCodes = {}));
  }
});

// node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces, maxCachedValues, cachedBreakLinesWithSpaces, supportedEols;
var init_string_intern = __esm({
  "node_modules/jsonc-parser/lib/esm/impl/string-intern.js"() {
    cachedSpaces = new Array(20).fill(0).map((_, index) => {
      return " ".repeat(index);
    });
    maxCachedValues = 200;
    cachedBreakLinesWithSpaces = {
      " ": {
        "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
          return "\n" + " ".repeat(index);
        }),
        "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
          return "\r" + " ".repeat(index);
        }),
        "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
          return "\r\n" + " ".repeat(index);
        })
      },
      "	": {
        "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
          return "\n" + "	".repeat(index);
        }),
        "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
          return "\r" + "	".repeat(index);
        }),
        "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
          return "\r\n" + "	".repeat(index);
        })
      }
    };
    supportedEols = ["\n", "\r", "\r\n"];
  }
});

// node_modules/jsonc-parser/lib/esm/impl/format.js
function format(documentText, range, options) {
  let initialIndentLevel;
  let formatText;
  let formatTextStart;
  let rangeStart;
  let rangeEnd;
  if (range) {
    rangeStart = range.offset;
    rangeEnd = rangeStart + range.length;
    formatTextStart = rangeStart;
    while (formatTextStart > 0 && !isEOL(documentText, formatTextStart - 1)) {
      formatTextStart--;
    }
    let endOffset = rangeEnd;
    while (endOffset < documentText.length && !isEOL(documentText, endOffset)) {
      endOffset++;
    }
    formatText = documentText.substring(formatTextStart, endOffset);
    initialIndentLevel = computeIndentLevel(formatText, options);
  } else {
    formatText = documentText;
    initialIndentLevel = 0;
    formatTextStart = 0;
    rangeStart = 0;
    rangeEnd = documentText.length;
  }
  const eol = getEOL(options, documentText);
  const eolFastPathSupported = supportedEols.includes(eol);
  let numberLineBreaks = 0;
  let indentLevel = 0;
  let indentValue;
  if (options.insertSpaces) {
    indentValue = cachedSpaces[options.tabSize || 4] ?? repeat(cachedSpaces[1], options.tabSize || 4);
  } else {
    indentValue = "	";
  }
  const indentType = indentValue === "	" ? "	" : " ";
  let scanner = createScanner(formatText, false);
  let hasError = false;
  function newLinesAndIndent() {
    if (numberLineBreaks > 1) {
      return repeat(eol, numberLineBreaks) + repeat(indentValue, initialIndentLevel + indentLevel);
    }
    const amountOfSpaces = indentValue.length * (initialIndentLevel + indentLevel);
    if (!eolFastPathSupported || amountOfSpaces > cachedBreakLinesWithSpaces[indentType][eol].length) {
      return eol + repeat(indentValue, initialIndentLevel + indentLevel);
    }
    if (amountOfSpaces <= 0) {
      return eol;
    }
    return cachedBreakLinesWithSpaces[indentType][eol][amountOfSpaces];
  }
  function scanNext() {
    let token = scanner.scan();
    numberLineBreaks = 0;
    while (token === 15 || token === 14) {
      if (token === 14 && options.keepLines) {
        numberLineBreaks += 1;
      } else if (token === 14) {
        numberLineBreaks = 1;
      }
      token = scanner.scan();
    }
    hasError = token === 16 || scanner.getTokenError() !== 0;
    return token;
  }
  const editOperations = [];
  function addEdit(text, startOffset, endOffset) {
    if (!hasError && (!range || startOffset < rangeEnd && endOffset > rangeStart) && documentText.substring(startOffset, endOffset) !== text) {
      editOperations.push({ offset: startOffset, length: endOffset - startOffset, content: text });
    }
  }
  let firstToken = scanNext();
  if (options.keepLines && numberLineBreaks > 0) {
    addEdit(repeat(eol, numberLineBreaks), 0, 0);
  }
  if (firstToken !== 17) {
    let firstTokenStart = scanner.getTokenOffset() + formatTextStart;
    let initialIndent = indentValue.length * initialIndentLevel < 20 && options.insertSpaces ? cachedSpaces[indentValue.length * initialIndentLevel] : repeat(indentValue, initialIndentLevel);
    addEdit(initialIndent, formatTextStart, firstTokenStart);
  }
  while (firstToken !== 17) {
    let firstTokenEnd = scanner.getTokenOffset() + scanner.getTokenLength() + formatTextStart;
    let secondToken = scanNext();
    let replaceContent = "";
    let needsLineBreak = false;
    while (numberLineBreaks === 0 && (secondToken === 12 || secondToken === 13)) {
      let commentTokenStart = scanner.getTokenOffset() + formatTextStart;
      addEdit(cachedSpaces[1], firstTokenEnd, commentTokenStart);
      firstTokenEnd = scanner.getTokenOffset() + scanner.getTokenLength() + formatTextStart;
      needsLineBreak = secondToken === 12;
      replaceContent = needsLineBreak ? newLinesAndIndent() : "";
      secondToken = scanNext();
    }
    if (secondToken === 2) {
      if (firstToken !== 1) {
        indentLevel--;
      }
      ;
      if (options.keepLines && numberLineBreaks > 0 || !options.keepLines && firstToken !== 1) {
        replaceContent = newLinesAndIndent();
      } else if (options.keepLines) {
        replaceContent = cachedSpaces[1];
      }
    } else if (secondToken === 4) {
      if (firstToken !== 3) {
        indentLevel--;
      }
      ;
      if (options.keepLines && numberLineBreaks > 0 || !options.keepLines && firstToken !== 3) {
        replaceContent = newLinesAndIndent();
      } else if (options.keepLines) {
        replaceContent = cachedSpaces[1];
      }
    } else {
      switch (firstToken) {
        case 3:
        case 1:
          indentLevel++;
          if (options.keepLines && numberLineBreaks > 0 || !options.keepLines) {
            replaceContent = newLinesAndIndent();
          } else {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 5:
          if (options.keepLines && numberLineBreaks > 0 || !options.keepLines) {
            replaceContent = newLinesAndIndent();
          } else {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 12:
          replaceContent = newLinesAndIndent();
          break;
        case 13:
          if (numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (!needsLineBreak) {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 6:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (!needsLineBreak) {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 10:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (secondToken === 6 && !needsLineBreak) {
            replaceContent = "";
          }
          break;
        case 7:
        case 8:
        case 9:
        case 11:
        case 2:
        case 4:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else {
            if ((secondToken === 12 || secondToken === 13) && !needsLineBreak) {
              replaceContent = cachedSpaces[1];
            } else if (secondToken !== 5 && secondToken !== 17) {
              hasError = true;
            }
          }
          break;
        case 16:
          hasError = true;
          break;
      }
      if (numberLineBreaks > 0 && (secondToken === 12 || secondToken === 13)) {
        replaceContent = newLinesAndIndent();
      }
    }
    if (secondToken === 17) {
      if (options.keepLines && numberLineBreaks > 0) {
        replaceContent = newLinesAndIndent();
      } else {
        replaceContent = options.insertFinalNewline ? eol : "";
      }
    }
    const secondTokenStart = scanner.getTokenOffset() + formatTextStart;
    addEdit(replaceContent, firstTokenEnd, secondTokenStart);
    firstToken = secondToken;
  }
  return editOperations;
}
function repeat(s, count) {
  let result = "";
  for (let i = 0; i < count; i++) {
    result += s;
  }
  return result;
}
function computeIndentLevel(content, options) {
  let i = 0;
  let nChars = 0;
  const tabSize = options.tabSize || 4;
  while (i < content.length) {
    let ch = content.charAt(i);
    if (ch === cachedSpaces[1]) {
      nChars++;
    } else if (ch === "	") {
      nChars += tabSize;
    } else {
      break;
    }
    i++;
  }
  return Math.floor(nChars / tabSize);
}
function getEOL(options, text) {
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "\r") {
      if (i + 1 < text.length && text.charAt(i + 1) === "\n") {
        return "\r\n";
      }
      return "\r";
    } else if (ch === "\n") {
      return "\n";
    }
  }
  return options && options.eol || "\n";
}
function isEOL(text, offset) {
  return "\r\n".indexOf(text.charAt(offset)) !== -1;
}
var init_format = __esm({
  "node_modules/jsonc-parser/lib/esm/impl/format.js"() {
    "use strict";
    init_scanner();
    init_string_intern();
  }
});

// node_modules/jsonc-parser/lib/esm/impl/parser.js
function getLocation(text, position) {
  const segments = [];
  const earlyReturnException = new Object();
  let previousNode = void 0;
  const previousNodeInst = {
    value: {},
    offset: 0,
    length: 0,
    type: "object",
    parent: void 0
  };
  let isAtPropertyKey = false;
  function setPreviousNode(value, offset, length, type) {
    previousNodeInst.value = value;
    previousNodeInst.offset = offset;
    previousNodeInst.length = length;
    previousNodeInst.type = type;
    previousNodeInst.colonOffset = void 0;
    previousNode = previousNodeInst;
  }
  try {
    visit(text, {
      onObjectBegin: (offset, length) => {
        if (position <= offset) {
          throw earlyReturnException;
        }
        previousNode = void 0;
        isAtPropertyKey = position > offset;
        segments.push("");
      },
      onObjectProperty: (name, offset, length) => {
        if (position < offset) {
          throw earlyReturnException;
        }
        setPreviousNode(name, offset, length, "property");
        segments[segments.length - 1] = name;
        if (position <= offset + length) {
          throw earlyReturnException;
        }
      },
      onObjectEnd: (offset, length) => {
        if (position <= offset) {
          throw earlyReturnException;
        }
        previousNode = void 0;
        segments.pop();
      },
      onArrayBegin: (offset, length) => {
        if (position <= offset) {
          throw earlyReturnException;
        }
        previousNode = void 0;
        segments.push(0);
      },
      onArrayEnd: (offset, length) => {
        if (position <= offset) {
          throw earlyReturnException;
        }
        previousNode = void 0;
        segments.pop();
      },
      onLiteralValue: (value, offset, length) => {
        if (position < offset) {
          throw earlyReturnException;
        }
        setPreviousNode(value, offset, length, getNodeType(value));
        if (position <= offset + length) {
          throw earlyReturnException;
        }
      },
      onSeparator: (sep, offset, length) => {
        if (position <= offset) {
          throw earlyReturnException;
        }
        if (sep === ":" && previousNode && previousNode.type === "property") {
          previousNode.colonOffset = offset;
          isAtPropertyKey = false;
          previousNode = void 0;
        } else if (sep === ",") {
          const last = segments[segments.length - 1];
          if (typeof last === "number") {
            segments[segments.length - 1] = last + 1;
          } else {
            isAtPropertyKey = true;
            segments[segments.length - 1] = "";
          }
          previousNode = void 0;
        }
      }
    });
  } catch (e) {
    if (e !== earlyReturnException) {
      throw e;
    }
  }
  return {
    path: segments,
    previousNode,
    isAtPropertyKey,
    matches: (pattern) => {
      let k = 0;
      for (let i = 0; k < pattern.length && i < segments.length; i++) {
        if (pattern[k] === segments[i] || pattern[k] === "*") {
          k++;
        } else if (pattern[k] !== "**") {
          return false;
        }
      }
      return k === pattern.length;
    }
  };
}
function parse(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentProperty = null;
  let currentParent = [];
  const previousParents = [];
  function onValue(value) {
    if (Array.isArray(currentParent)) {
      currentParent.push(value);
    } else if (currentProperty !== null) {
      currentParent[currentProperty] = value;
    }
  }
  const visitor = {
    onObjectBegin: () => {
      const object = {};
      onValue(object);
      previousParents.push(currentParent);
      currentParent = object;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array = [];
      onValue(array);
      previousParents.push(currentParent);
      currentParent = array;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function parseTree(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentParent = { type: "array", offset: -1, length: -1, children: [], parent: void 0 };
  function ensurePropertyComplete(endOffset) {
    if (currentParent.type === "property") {
      currentParent.length = endOffset - currentParent.offset;
      currentParent = currentParent.parent;
    }
  }
  function onValue(valueNode) {
    currentParent.children.push(valueNode);
    return valueNode;
  }
  const visitor = {
    onObjectBegin: (offset) => {
      currentParent = onValue({ type: "object", offset, length: -1, parent: currentParent, children: [] });
    },
    onObjectProperty: (name, offset, length) => {
      currentParent = onValue({ type: "property", offset, length: -1, parent: currentParent, children: [] });
      currentParent.children.push({ type: "string", value: name, offset, length, parent: currentParent });
    },
    onObjectEnd: (offset, length) => {
      ensurePropertyComplete(offset + length);
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onArrayBegin: (offset, length) => {
      currentParent = onValue({ type: "array", offset, length: -1, parent: currentParent, children: [] });
    },
    onArrayEnd: (offset, length) => {
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onLiteralValue: (value, offset, length) => {
      onValue({ type: getNodeType(value), offset, length, parent: currentParent, value });
      ensurePropertyComplete(offset + length);
    },
    onSeparator: (sep, offset, length) => {
      if (currentParent.type === "property") {
        if (sep === ":") {
          currentParent.colonOffset = offset;
        } else if (sep === ",") {
          ensurePropertyComplete(offset);
        }
      }
    },
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  const result = currentParent.children[0];
  if (result) {
    delete result.parent;
  }
  return result;
}
function findNodeAtLocation(root, path5) {
  if (!root) {
    return void 0;
  }
  let node = root;
  for (let segment of path5) {
    if (typeof segment === "string") {
      if (node.type !== "object" || !Array.isArray(node.children)) {
        return void 0;
      }
      let found = false;
      for (const propertyNode of node.children) {
        if (Array.isArray(propertyNode.children) && propertyNode.children[0].value === segment && propertyNode.children.length === 2) {
          node = propertyNode.children[1];
          found = true;
          break;
        }
      }
      if (!found) {
        return void 0;
      }
    } else {
      const index = segment;
      if (node.type !== "array" || index < 0 || !Array.isArray(node.children) || index >= node.children.length) {
        return void 0;
      }
      node = node.children[index];
    }
  }
  return node;
}
function getNodePath(node) {
  if (!node.parent || !node.parent.children) {
    return [];
  }
  const path5 = getNodePath(node.parent);
  if (node.parent.type === "property") {
    const key = node.parent.children[0].value;
    path5.push(key);
  } else if (node.parent.type === "array") {
    const index = node.parent.children.indexOf(node);
    if (index !== -1) {
      path5.push(index);
    }
  }
  return path5;
}
function getNodeValue(node) {
  switch (node.type) {
    case "array":
      return node.children.map(getNodeValue);
    case "object":
      const obj = /* @__PURE__ */ Object.create(null);
      for (let prop of node.children) {
        const valueNode = prop.children[1];
        if (valueNode) {
          obj[prop.children[0].value] = getNodeValue(valueNode);
        }
      }
      return obj;
    case "null":
    case "string":
    case "number":
    case "boolean":
      return node.value;
    default:
      return void 0;
  }
}
function contains(node, offset, includeRightBound = false) {
  return offset >= node.offset && offset < node.offset + node.length || includeRightBound && offset === node.offset + node.length;
}
function findNodeAtOffset(node, offset, includeRightBound = false) {
  if (contains(node, offset, includeRightBound)) {
    const children = node.children;
    if (Array.isArray(children)) {
      for (let i = 0; i < children.length && children[i].offset <= offset; i++) {
        const item = findNodeAtOffset(children[i], offset, includeRightBound);
        if (item) {
          return item;
        }
      }
    }
    return node;
  }
  return void 0;
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(
            14
            /* ParseErrorCode.InvalidUnicode */
          );
          break;
        case 5:
          handleError(
            15
            /* ParseErrorCode.InvalidEscapeCharacter */
          );
          break;
        case 3:
          handleError(
            13
            /* ParseErrorCode.UnexpectedEndOfNumber */
          );
          break;
        case 1:
          if (!disallowComments) {
            handleError(
              11
              /* ParseErrorCode.UnexpectedEndOfComment */
            );
          }
          break;
        case 2:
          handleError(
            12
            /* ParseErrorCode.UnexpectedEndOfString */
          );
          break;
        case 6:
          handleError(
            16
            /* ParseErrorCode.InvalidCharacter */
          );
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(
              10
              /* ParseErrorCode.InvalidCommentToken */
            );
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(
            1
            /* ParseErrorCode.InvalidSymbol */
          );
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(
            2
            /* ParseErrorCode.InvalidNumberFormat */
          );
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
    } else {
      handleError(5, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [
        2
        /* SyntaxKind.CloseBraceToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [
          4,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [
        4
        /* SyntaxKind.CloseBracketToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}
function stripComments(text, replaceCh) {
  let _scanner = createScanner(text), parts = [], kind, offset = 0, pos;
  do {
    pos = _scanner.getPosition();
    kind = _scanner.scan();
    switch (kind) {
      case 12:
      case 13:
      case 17:
        if (offset !== pos) {
          parts.push(text.substring(offset, pos));
        }
        if (replaceCh !== void 0) {
          parts.push(_scanner.getTokenValue().replace(/[^\r\n]/g, replaceCh));
        }
        offset = _scanner.getPosition();
        break;
    }
  } while (kind !== 17);
  return parts.join("");
}
function getNodeType(value) {
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "object": {
      if (!value) {
        return "null";
      } else if (Array.isArray(value)) {
        return "array";
      }
      return "object";
    }
    default:
      return "null";
  }
}
var ParseOptions;
var init_parser = __esm({
  "node_modules/jsonc-parser/lib/esm/impl/parser.js"() {
    "use strict";
    init_scanner();
    (function(ParseOptions2) {
      ParseOptions2.DEFAULT = {
        allowTrailingComma: false
      };
    })(ParseOptions || (ParseOptions = {}));
  }
});

// node_modules/jsonc-parser/lib/esm/impl/edit.js
function setProperty(text, originalPath, value, options) {
  const path5 = originalPath.slice();
  const errors = [];
  const root = parseTree(text, errors);
  let parent = void 0;
  let lastSegment = void 0;
  while (path5.length > 0) {
    lastSegment = path5.pop();
    parent = findNodeAtLocation(root, path5);
    if (parent === void 0 && value !== void 0) {
      if (typeof lastSegment === "string") {
        value = { [lastSegment]: value };
      } else {
        value = [value];
      }
    } else {
      break;
    }
  }
  if (!parent) {
    if (value === void 0) {
      throw new Error("Can not delete in empty document");
    }
    return withFormatting(text, { offset: root ? root.offset : 0, length: root ? root.length : 0, content: JSON.stringify(value) }, options);
  } else if (parent.type === "object" && typeof lastSegment === "string" && Array.isArray(parent.children)) {
    const existing = findNodeAtLocation(parent, [lastSegment]);
    if (existing !== void 0) {
      if (value === void 0) {
        if (!existing.parent) {
          throw new Error("Malformed AST");
        }
        const propertyIndex = parent.children.indexOf(existing.parent);
        let removeBegin;
        let removeEnd = existing.parent.offset + existing.parent.length;
        if (propertyIndex > 0) {
          let previous = parent.children[propertyIndex - 1];
          removeBegin = previous.offset + previous.length;
        } else {
          removeBegin = parent.offset + 1;
          if (parent.children.length > 1) {
            let next = parent.children[1];
            removeEnd = next.offset;
          }
        }
        return withFormatting(text, { offset: removeBegin, length: removeEnd - removeBegin, content: "" }, options);
      } else {
        return withFormatting(text, { offset: existing.offset, length: existing.length, content: JSON.stringify(value) }, options);
      }
    } else {
      if (value === void 0) {
        return [];
      }
      const newProperty = `${JSON.stringify(lastSegment)}: ${JSON.stringify(value)}`;
      const index = options.getInsertionIndex ? options.getInsertionIndex(parent.children.map((p) => p.children[0].value)) : parent.children.length;
      let edit;
      if (index > 0) {
        let previous = parent.children[index - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      } else if (parent.children.length === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty };
      } else {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty + "," };
      }
      return withFormatting(text, edit, options);
    }
  } else if (parent.type === "array" && typeof lastSegment === "number" && Array.isArray(parent.children)) {
    const insertIndex = lastSegment;
    if (insertIndex === -1) {
      const newProperty = `${JSON.stringify(value)}`;
      let edit;
      if (parent.children.length === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty };
      } else {
        const previous = parent.children[parent.children.length - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      }
      return withFormatting(text, edit, options);
    } else if (value === void 0 && parent.children.length >= 0) {
      const removalIndex = lastSegment;
      const toRemove = parent.children[removalIndex];
      let edit;
      if (parent.children.length === 1) {
        edit = { offset: parent.offset + 1, length: parent.length - 2, content: "" };
      } else if (parent.children.length - 1 === removalIndex) {
        let previous = parent.children[removalIndex - 1];
        let offset = previous.offset + previous.length;
        let parentEndOffset = parent.offset + parent.length;
        edit = { offset, length: parentEndOffset - 2 - offset, content: "" };
      } else {
        edit = { offset: toRemove.offset, length: parent.children[removalIndex + 1].offset - toRemove.offset, content: "" };
      }
      return withFormatting(text, edit, options);
    } else if (value !== void 0) {
      let edit;
      const newProperty = `${JSON.stringify(value)}`;
      if (!options.isArrayInsertion && parent.children.length > lastSegment) {
        const toModify = parent.children[lastSegment];
        edit = { offset: toModify.offset, length: toModify.length, content: newProperty };
      } else if (parent.children.length === 0 || lastSegment === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: parent.children.length === 0 ? newProperty : newProperty + "," };
      } else {
        const index = lastSegment > parent.children.length ? parent.children.length : lastSegment;
        const previous = parent.children[index - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      }
      return withFormatting(text, edit, options);
    } else {
      throw new Error(`Can not ${value === void 0 ? "remove" : options.isArrayInsertion ? "insert" : "modify"} Array index ${insertIndex} as length is not sufficient`);
    }
  } else {
    throw new Error(`Can not add ${typeof lastSegment !== "number" ? "index" : "property"} to parent of type ${parent.type}`);
  }
}
function withFormatting(text, edit, options) {
  if (!options.formattingOptions) {
    return [edit];
  }
  let newText = applyEdit(text, edit);
  let begin = edit.offset;
  let end = edit.offset + edit.content.length;
  if (edit.length === 0 || edit.content.length === 0) {
    while (begin > 0 && !isEOL(newText, begin - 1)) {
      begin--;
    }
    while (end < newText.length && !isEOL(newText, end)) {
      end++;
    }
  }
  const edits = format(newText, { offset: begin, length: end - begin }, { ...options.formattingOptions, keepLines: false });
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit2 = edits[i];
    newText = applyEdit(newText, edit2);
    begin = Math.min(begin, edit2.offset);
    end = Math.max(end, edit2.offset + edit2.length);
    end += edit2.content.length - edit2.length;
  }
  const editLength = text.length - (newText.length - end) - begin;
  return [{ offset: begin, length: editLength, content: newText.substring(begin, end) }];
}
function applyEdit(text, edit) {
  return text.substring(0, edit.offset) + edit.content + text.substring(edit.offset + edit.length);
}
var init_edit = __esm({
  "node_modules/jsonc-parser/lib/esm/impl/edit.js"() {
    "use strict";
    init_format();
    init_parser();
  }
});

// node_modules/jsonc-parser/lib/esm/main.js
var main_exports = {};
__export(main_exports, {
  ParseErrorCode: () => ParseErrorCode,
  ScanError: () => ScanError,
  SyntaxKind: () => SyntaxKind,
  applyEdits: () => applyEdits,
  createScanner: () => createScanner2,
  findNodeAtLocation: () => findNodeAtLocation2,
  findNodeAtOffset: () => findNodeAtOffset2,
  format: () => format2,
  getLocation: () => getLocation2,
  getNodePath: () => getNodePath2,
  getNodeValue: () => getNodeValue2,
  modify: () => modify,
  parse: () => parse2,
  parseTree: () => parseTree2,
  printParseErrorCode: () => printParseErrorCode,
  stripComments: () => stripComments2,
  visit: () => visit2
});
function printParseErrorCode(code) {
  switch (code) {
    case 1:
      return "InvalidSymbol";
    case 2:
      return "InvalidNumberFormat";
    case 3:
      return "PropertyNameExpected";
    case 4:
      return "ValueExpected";
    case 5:
      return "ColonExpected";
    case 6:
      return "CommaExpected";
    case 7:
      return "CloseBraceExpected";
    case 8:
      return "CloseBracketExpected";
    case 9:
      return "EndOfFileExpected";
    case 10:
      return "InvalidCommentToken";
    case 11:
      return "UnexpectedEndOfComment";
    case 12:
      return "UnexpectedEndOfString";
    case 13:
      return "UnexpectedEndOfNumber";
    case 14:
      return "InvalidUnicode";
    case 15:
      return "InvalidEscapeCharacter";
    case 16:
      return "InvalidCharacter";
  }
  return "<unknown ParseErrorCode>";
}
function format2(documentText, range, options) {
  return format(documentText, range, options);
}
function modify(text, path5, value, options) {
  return setProperty(text, path5, value, options);
}
function applyEdits(text, edits) {
  let sortedEdits = edits.slice(0).sort((a, b) => {
    const diff = a.offset - b.offset;
    if (diff === 0) {
      return a.length - b.length;
    }
    return diff;
  });
  let lastModifiedOffset = text.length;
  for (let i = sortedEdits.length - 1; i >= 0; i--) {
    let e = sortedEdits[i];
    if (e.offset + e.length <= lastModifiedOffset) {
      text = applyEdit(text, e);
    } else {
      throw new Error("Overlapping edit");
    }
    lastModifiedOffset = e.offset;
  }
  return text;
}
var createScanner2, ScanError, SyntaxKind, getLocation2, parse2, parseTree2, findNodeAtLocation2, findNodeAtOffset2, getNodePath2, getNodeValue2, visit2, stripComments2, ParseErrorCode;
var init_main = __esm({
  "node_modules/jsonc-parser/lib/esm/main.js"() {
    "use strict";
    init_format();
    init_edit();
    init_scanner();
    init_parser();
    createScanner2 = createScanner;
    (function(ScanError2) {
      ScanError2[ScanError2["None"] = 0] = "None";
      ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
      ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
      ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
      ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
      ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
      ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
    })(ScanError || (ScanError = {}));
    (function(SyntaxKind2) {
      SyntaxKind2[SyntaxKind2["OpenBraceToken"] = 1] = "OpenBraceToken";
      SyntaxKind2[SyntaxKind2["CloseBraceToken"] = 2] = "CloseBraceToken";
      SyntaxKind2[SyntaxKind2["OpenBracketToken"] = 3] = "OpenBracketToken";
      SyntaxKind2[SyntaxKind2["CloseBracketToken"] = 4] = "CloseBracketToken";
      SyntaxKind2[SyntaxKind2["CommaToken"] = 5] = "CommaToken";
      SyntaxKind2[SyntaxKind2["ColonToken"] = 6] = "ColonToken";
      SyntaxKind2[SyntaxKind2["NullKeyword"] = 7] = "NullKeyword";
      SyntaxKind2[SyntaxKind2["TrueKeyword"] = 8] = "TrueKeyword";
      SyntaxKind2[SyntaxKind2["FalseKeyword"] = 9] = "FalseKeyword";
      SyntaxKind2[SyntaxKind2["StringLiteral"] = 10] = "StringLiteral";
      SyntaxKind2[SyntaxKind2["NumericLiteral"] = 11] = "NumericLiteral";
      SyntaxKind2[SyntaxKind2["LineCommentTrivia"] = 12] = "LineCommentTrivia";
      SyntaxKind2[SyntaxKind2["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
      SyntaxKind2[SyntaxKind2["LineBreakTrivia"] = 14] = "LineBreakTrivia";
      SyntaxKind2[SyntaxKind2["Trivia"] = 15] = "Trivia";
      SyntaxKind2[SyntaxKind2["Unknown"] = 16] = "Unknown";
      SyntaxKind2[SyntaxKind2["EOF"] = 17] = "EOF";
    })(SyntaxKind || (SyntaxKind = {}));
    getLocation2 = getLocation;
    parse2 = parse;
    parseTree2 = parseTree;
    findNodeAtLocation2 = findNodeAtLocation;
    findNodeAtOffset2 = findNodeAtOffset;
    getNodePath2 = getNodePath;
    getNodeValue2 = getNodeValue;
    visit2 = visit;
    stripComments2 = stripComments;
    (function(ParseErrorCode2) {
      ParseErrorCode2[ParseErrorCode2["InvalidSymbol"] = 1] = "InvalidSymbol";
      ParseErrorCode2[ParseErrorCode2["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
      ParseErrorCode2[ParseErrorCode2["PropertyNameExpected"] = 3] = "PropertyNameExpected";
      ParseErrorCode2[ParseErrorCode2["ValueExpected"] = 4] = "ValueExpected";
      ParseErrorCode2[ParseErrorCode2["ColonExpected"] = 5] = "ColonExpected";
      ParseErrorCode2[ParseErrorCode2["CommaExpected"] = 6] = "CommaExpected";
      ParseErrorCode2[ParseErrorCode2["CloseBraceExpected"] = 7] = "CloseBraceExpected";
      ParseErrorCode2[ParseErrorCode2["CloseBracketExpected"] = 8] = "CloseBracketExpected";
      ParseErrorCode2[ParseErrorCode2["EndOfFileExpected"] = 9] = "EndOfFileExpected";
      ParseErrorCode2[ParseErrorCode2["InvalidCommentToken"] = 10] = "InvalidCommentToken";
      ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
      ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
      ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
      ParseErrorCode2[ParseErrorCode2["InvalidUnicode"] = 14] = "InvalidUnicode";
      ParseErrorCode2[ParseErrorCode2["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
      ParseErrorCode2[ParseErrorCode2["InvalidCharacter"] = 16] = "InvalidCharacter";
    })(ParseErrorCode || (ParseErrorCode = {}));
  }
});

// install-config.mjs
init_main();
import { access as access4, mkdir as mkdir4, readFile as readFile4, writeFile as writeFile4, rm as rm3, copyFile as copyFile2, lstat as lstat3 } from "node:fs/promises";
import os from "node:os";
import path4 from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// host-components.mjs
import { readFile, writeFile, rename, access, mkdir, rm, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
var names = ["patchline", "target"];
var versionPattern = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
async function withHostLock(configDir, operation, { timeout = 12e4 } = {}) {
  await mkdir(configDir, { recursive: true });
  const directory = await realpath(configDir);
  const lock = path.join(directory, ".host-components.lock");
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await lstat(lock)).isDirectory()) throw new Error("Unsafe host lock");
      if (Date.now() - started >= timeout) throw new Error("Host operation lock timeout; inspect the owner before recovery");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started: (/* @__PURE__ */ new Date()).toISOString() }), { flag: "wx" });
    return await operation();
  } finally {
    await rm(lock, { recursive: true });
  }
}
function hostVersion(upstream, components) {
  if (!versionPattern.test(upstream)) throw new Error("Invalid upstream version");
  return upstream + names.filter((name) => components[name] && components[name].requiresHost !== false).map((name) => {
    const version = components[name].version;
    if (!versionPattern.test(version)) throw new Error(`Invalid ${name} version`);
    return `+${name}.${version}`;
  }).join("");
}
function hostSemver(upstream, components) {
  const display = hostVersion(upstream, components);
  const [base, ...metadata] = display.split("+");
  return base + (metadata.length ? `+${metadata.join(".")}` : "");
}
async function manifest(configDir) {
  try {
    const file = path.join(configDir, "host-components.json");
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe symlink host manifest");
    const result = JSON.parse(await readFile(file, "utf8"));
    if (result.schema !== 1 || !result.components || typeof result.components !== "object") throw new Error("Invalid host component manifest");
    return result;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { schema: 1, components: {} };
  }
}
async function readComponents(configDir) {
  const result = {};
  for (const [name, component] of Object.entries((await manifest(configDir)).components)) {
    if (!names.includes(name)) continue;
    hostVersion("1.0.0", { [name]: component });
    if (!Array.isArray(component.files) || !component.files.length) continue;
    let present = true;
    for (const file of component.files) {
      if (typeof file !== "string" || path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw new Error("Unsafe component file path");
      try {
        await access(path.resolve(configDir, file));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        present = false;
      }
    }
    if (present && component.registration) {
      const { parse: parse3 } = await Promise.resolve().then(() => (init_main(), main_exports));
      const layers = {};
      for (const kind of ["opencode", "tui"]) {
        layers[kind] = [];
        for (const extension of ["json", "jsonc"]) {
          try {
            const errors = [];
            const config = parse3(await readFile(path.join(configDir, `${kind}.${extension}`), "utf8"), errors, { allowTrailingComma: true });
            if (errors.length) throw new Error("Invalid component registration config");
            layers[kind].push(config);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
      }
      for (const kind of ["opencode", "tui"]) {
        const registered = layers[kind].some((layer) => (layer.plugin || []).some((entry) => {
          const spec = Array.isArray(entry) ? entry[0] : entry;
          if (typeof spec !== "string") return false;
          if (spec === component.registration || spec.startsWith(`${component.registration}@`) || spec.startsWith(`${component.registration}/`)) return true;
          return spec.replaceAll("\\", "/").replace(/\/$/, "").endsWith(name === "target" ? "/target.js" : "/opencode-patchline");
        }));
        const enabled = Object.assign({}, ...layers[kind].map((layer) => layer.plugin_enabled));
        const discovered = name === "target" && kind === "opencode" && component.files.includes("plugins/target.js");
        if (!registered && !discovered || enabled[kind === "tui" ? `${component.registration}-tui` : component.registration] === false || enabled[component.registration] === false) present = false;
      }
    }
    if (present && component.packageFile) {
      if (typeof component.packageFile !== "string" || path.isAbsolute(component.packageFile) || component.packageFile.split(/[\\/]/).includes("..")) throw new Error("Unsafe component package path");
      const pkg = JSON.parse(await readFile(path.join(configDir, component.packageFile), "utf8"));
      hostVersion("1.0.0", { [name]: { version: pkg.version } });
      result[name] = { ...component, version: pkg.version };
    } else if (present) result[name] = component;
  }
  return result;
}
async function saveManifest(configDir, result) {
  const file = path.join(configDir, "host-components.json");
  await manifest(configDir);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
async function reconcileHostLocked(configDir, upstream, { build, install, verify }) {
  const components = await readComponents(configDir);
  const version = hostVersion(upstream, components);
  const binary = await build({ upstream, components, version });
  let restore;
  try {
    restore = await install(binary);
    if (verify) await verify(version);
    const result = await manifest(configDir);
    result.host = { upstream, version, components, installedAt: (/* @__PURE__ */ new Date()).toISOString() };
    await saveManifest(configDir, result);
    return result.host;
  } catch (error) {
    if (restore) {
      try {
        await restore();
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Host installation failed; rollback incomplete");
      }
    }
    throw error;
  }
}
async function registerComponent(configDir, name, component) {
  return withHostLock(configDir, () => registerComponentLocked(configDir, name, component));
}
async function registerComponentLocked(configDir, name, component) {
  if (!names.includes(name)) throw new Error("Unknown host component");
  const result = await manifest(configDir);
  if (component) {
    hostVersion("1.0.0", { [name]: component });
    if (!Array.isArray(component.files) || !component.files.length || component.files.some((file) => typeof file !== "string" || path.isAbsolute(file) || file.split(/[\\/]/).includes(".."))) throw new Error("Unsafe component file path");
    result.components[name] = component;
  } else delete result.components[name];
  await saveManifest(configDir, result);
  return readComponents(configDir);
}

// host-runtime.mjs
import { access as access3, readFile as readFile3, writeFile as writeFile3, copyFile, rename as rename2, rm as rm2, lstat as lstat2, realpath as realpath3, mkdir as mkdir3 } from "node:fs/promises";
import path3 from "node:path";
import { randomUUID as randomUUID2, createHash } from "node:crypto";

// host-build.mjs
import { readFile as readFile2, writeFile as writeFile2, mkdir as mkdir2, realpath as realpath2, access as access2 } from "node:fs/promises";
import path2 from "node:path";
import { spawn } from "node:child_process";
function replace(source, anchor, replacement) {
  if (!source.includes(anchor)) throw new Error(`Unsupported OpenCode seam: ${anchor}`);
  return source.replace(anchor, replacement);
}
function transformHostFile(kind, source, components, coordinator = "", configDir = "") {
  if (kind === "registry" && components.patchline) {
    source = replace(source, "if (tool.id === ApplyPatchTool.id) return usePatch", "if (tool.id === ApplyPatchTool.id) return true");
    source = replace(source, "if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch", "if (tool.id === EditTool.id || tool.id === WriteTool.id) return true");
  }
  if (kind === "session" && components.patchline) {
    const start = source.indexOf("function ToolPart(props:");
    const end = source.indexOf("type ToolProps =", start);
    if (start < 0 || end < 0) throw new Error("Unsupported OpenCode ToolPart");
    let block = source.slice(start, end);
    block = replace(block, "  const ctx = use()", "  const ctx = use()\n  const pluginRuntime = usePluginRuntime()");
    block = replace(block, "<Switch>", '<pluginRuntime.Slot name={`tool_${props.part.tool}`} mode="replace" part={props.part} message={props.message} last={props.last}>\n      <Switch>');
    block = replace(block, "</Switch>", "</Switch>\n      </pluginRuntime.Slot>");
    source = source.slice(0, start) + block + source.slice(end);
    if (!source.includes("import { usePluginRuntime }")) source = 'import { usePluginRuntime } from "../../plugin/runtime"\n' + source;
  }
  if (kind === "installation") {
    source = replace(source, "semver.major(current)", 'semver.major(current.split("+")[0]!)');
    source = replace(source, "semver.minor(current)", 'semver.minor(current.split("+")[0]!)');
    if (Object.keys(components).length) {
      const anchor = 'upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {';
      source = replace(source, anchor, `${anchor}
        // Shared component host upgrade; installer-independent.
        const coordinated = yield* run(["node", ${JSON.stringify(coordinator)}, "--config-dir", ${JSON.stringify(configDir)}, "--upstream", target])
        if (coordinated.code !== 0) return yield* Effect.fail(new UpgradeFailedError({ stderr: coordinated.stderr || coordinated.stdout }))
        return`);
    }
  }
  if (kind === "compatibility") source = replace(source, "export async function checkPluginCompatibility(target: string, opencodeVersion: string, pkg?: PluginPackage) {", 'export async function checkPluginCompatibility(target: string, opencodeVersion: string, pkg?: PluginPackage) {\n  const [base, ...metadata] = opencodeVersion.split("+")\n  opencodeVersion = base + (metadata.length ? `+${metadata.join(".")}` : "")');
  return source;
}
async function runHostCommand(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
      if (process.env.HOST_BUILD_VERBOSE) process.stderr.write(data);
    });
    child.stderr.on("data", (data) => {
      output += data;
      if (process.env.HOST_BUILD_VERBOSE) process.stderr.write(data);
    });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${output}`)));
  });
}
async function buildHost({ upstream, components, configDir, coordinator }) {
  components = Object.fromEntries(Object.entries(components).filter(([, component]) => component.requiresHost !== false));
  hostVersion(upstream, components);
  const host = path2.join(configDir, "host-build", upstream);
  await mkdir2(path2.dirname(host), { recursive: true });
  try {
    await access2(path2.join(host, ".git"));
  } catch {
    await runHostCommand("git", ["clone", "--depth", "1", "--branch", `v${upstream}`, "https://github.com/anomalyco/opencode.git", host], configDir);
  }
  if (await runHostCommand("git", ["describe", "--tags", "--exact-match", "HEAD"], host) !== `v${upstream}`) throw new Error("Host checkout version mismatch");
  const seams = {
    prompt: "packages/tui/src/component/prompt/index.tsx",
    session: "packages/tui/src/routes/session/index.tsx",
    registry: "packages/opencode/src/tool/registry.ts",
    installation: "packages/opencode/src/installation/index.ts",
    compatibility: "packages/opencode/src/plugin/shared.ts"
  };
  for (const [kind, file] of Object.entries(seams)) {
    const source = await runHostCommand("git", ["show", `HEAD:${file}`], host);
    await writeFile2(path2.join(host, file), transformHostFile(kind, source.replaceAll("\r\n", "\n"), components, coordinator, configDir) + "\n");
  }
  const script = "packages/script/src/index.ts";
  const scriptSource = await runHostCommand("git", ["show", `HEAD:${script}`], host);
  await writeFile2(path2.join(host, script), scriptSource);
  const build = "packages/opencode/script/build.ts";
  const buildSource = await runHostCommand("git", ["show", `HEAD:${build}`], host);
  const versionAnchor = "OPENCODE_VERSION: `'${Script.version}'`";
  await writeFile2(path2.join(host, build), replace(buildSource, versionAnchor, `OPENCODE_VERSION: ${JSON.stringify(JSON.stringify(hostVersion(upstream, components)))}`));
  await runHostCommand("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], host);
  await runHostCommand("bun", ["install", "--frozen-lockfile"], host);
  await runHostCommand("bun", ["run", "script/build.ts", "--single", "--skip-install", "--skip-embed-web-ui"], path2.join(host, "packages/opencode"), { OPENCODE_VERSION: hostSemver(upstream, components), OPENCODE_CHANNEL: "latest" });
  const binary = path2.join(host, "packages/opencode/dist", `opencode-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`, "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
  await access2(binary);
  return realpath2(binary);
}

// host-runtime.mjs
async function resolveHostBinary() {
  if (process.env.OPENCODE_HOST_BINARY) return realpath3(process.env.OPENCODE_HOST_BINARY);
  for (const directory of (process.env.PATH || "").split(path3.delimiter).filter(Boolean)) {
    for (const file of [path3.join(directory, process.platform === "win32" ? "opencode.exe" : "opencode"), path3.join(directory, "node_modules/opencode-ai/bin/opencode.exe")]) {
      try {
        await access3(file);
        return realpath3(file);
      } catch {
      }
    }
  }
  throw new Error("Cannot resolve OpenCode executable");
}
var digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function binarySnapshot(file) {
  const info = await lstat2(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Host binary must be a regular non-symlink file");
  return { dev: info.dev, ino: info.ino, hash: digest(await readFile3(file)) };
}
async function assertBinary(file, expected) {
  const current = await binarySnapshot(file);
  if (current.dev !== expected.dev || current.ino !== expected.ino || current.hash !== expected.hash) throw new Error("Host binary changed externally");
}
async function replaceHostBinary(source, target) {
  target = await realpath3(target);
  const parent = path3.dirname(target);
  const directory = await lstat2(parent);
  const before = await binarySnapshot(target);
  await binarySnapshot(source);
  const temporary = path3.join(parent, `.host-${randomUUID2()}`);
  const backup = `${temporary}.previous`;
  await copyFile(source, temporary, 1);
  try {
    await assertBinary(target, before);
    const current = await lstat2(parent);
    if (current.dev !== directory.dev || current.ino !== directory.ino || current.isSymbolicLink()) throw new Error("Host parent changed externally");
    await rename2(target, backup);
    try {
      await rename2(temporary, target);
    } catch (error) {
      await rename2(backup, target);
      throw error;
    }
    const landed = await binarySnapshot(target);
    const previous = await binarySnapshot(backup);
    return async () => {
      await assertBinary(target, landed);
      await assertBinary(backup, previous);
      await rename2(target, temporary);
      try {
        await rename2(backup, target);
      } catch (error) {
        await rename2(temporary, target);
        throw error;
      }
      await rm2(temporary);
    };
  } finally {
    await rm2(temporary, { force: true });
  }
}
async function deployHostRuntime(configDir) {
  const destination = path3.join(configDir, "host-runtime");
  await mkdir3(destination, { recursive: true });
  if (await realpath3(destination) !== path3.resolve(destination)) throw new Error("Unsafe host runtime directory");
  for (const name of ["host-components.mjs", "host-build.mjs", "host-runtime.mjs", "host-cli.mjs"]) {
    const target = path3.join(destination, name);
    try {
      if ((await lstat2(target)).isSymbolicLink()) throw new Error("Unsafe host runtime file");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const source = name === "host-components.mjs" && !import.meta.url.replaceAll("\\", "/").includes("/dist/") ? new URL("./dist/host-components.mjs", import.meta.url) : new URL(name, import.meta.url);
    await writeFile3(target, await readFile3(source));
  }
  return path3.join(destination, "host-cli.mjs");
}
async function installCoordinatedHostLocked(configDir, upstream) {
  const target = await resolveHostBinary();
  if (!upstream) upstream = (await runHostCommand(target, ["--version"], configDir)).split("+")[0];
  const coordinator = await deployHostRuntime(configDir);
  return reconcileHostLocked(configDir, upstream, {
    build: (composition) => buildHost({ ...composition, configDir, coordinator }),
    install: (binary) => replaceHostBinary(binary, target),
    verify: async (version) => {
      if (await runHostCommand(target, ["--version"], configDir) !== version) throw new Error("Installed host version mismatch");
    }
  });
}

// install-config.mjs
var TUI_PLUGIN_ID = "opencode-target-tui";
function parseJsonc(text) {
  const errors = [];
  const value = parse2(text.replace(/^\uFEFF/, ""), errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new Error(`Invalid TUI config JSONC at offset ${errors[0].offset}`);
  return value;
}
async function selectTuiConfigPath(configDir) {
  for (const name of ["tui.jsonc", "tui.json"]) {
    const candidate = path4.join(configDir, name);
    try {
      await access4(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return path4.join(configDir, "tui.json");
}
function relativePluginPath(configPath, configDir) {
  const installed = path4.join(configDir, "tui-plugins", "target.js");
  const relative = path4.relative(path4.dirname(configPath), installed).replaceAll(path4.sep, "/");
  if (path4.isAbsolute(relative)) return pathToFileURL(installed).href;
  return relative.startsWith(".") ? relative : `./${relative}`;
}
function isTargetPlugin(value, configPath, configDir) {
  if (Array.isArray(value)) return isTargetPlugin(value[0], configPath, configDir);
  if (typeof value !== "string") return false;
  if (value === "opencode-target" || value.startsWith("opencode-target@")) return true;
  if (value.startsWith("file:")) {
    try {
      value = fileURLToPath(value);
    } catch {
      return false;
    }
  }
  return path4.resolve(path4.dirname(configPath), value) === path4.resolve(configDir, "tui-plugins", "target.js");
}
function applyModify(text, pathSegments, value) {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const content = text.slice(bom.length);
  const indent = content.match(/\r?\n([\t ]+)"/)?.[1];
  return bom + applyEdits(content, modify(content, pathSegments, value, {
    formattingOptions: {
      insertSpaces: !indent?.includes("	"),
      tabSize: indent && !indent.includes("	") ? indent.length : 2,
      eol: text.includes("\r\n") ? "\r\n" : "\n"
    }
  }));
}
async function loadConfig(configPath) {
  let original = "";
  try {
    original = await readFile4(configPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const config = original ? parseJsonc(original) : {};
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("tui config must be an object");
  if (config.plugin !== void 0 && !Array.isArray(config.plugin)) throw new Error("plugin must be an array");
  if (config.plugin_enabled !== void 0 && (!config.plugin_enabled || typeof config.plugin_enabled !== "object" || Array.isArray(config.plugin_enabled))) {
    throw new Error("plugin_enabled must be an object");
  }
  return { original, config, configPath };
}
async function configureTuiConfig({ configDir, tuiConfig = null }) {
  configDir = path4.resolve(configDir);
  const configPath = tuiConfig ? path4.resolve(String(tuiConfig)) : await selectTuiConfigPath(configDir);
  const paths = [.../* @__PURE__ */ new Set([path4.join(configDir, "tui.json"), path4.join(configDir, "tui.jsonc"), configPath])];
  const layers = await Promise.all(paths.map(loadConfig));
  const { original, config } = layers.find((item) => item.configPath === configPath);
  const pluginPath = relativePluginPath(configPath, configDir);
  const present = layers.some((layer) => layer.config.plugin?.some((item) => isTargetPlugin(item, layer.configPath, configDir)));
  const enabled = Object.assign({}, ...layers.map((layer) => layer.config.plugin_enabled));
  let next = original;
  if (!original) next = '{\n  "$schema": "https://opencode.ai/tui.json"\n}\n';
  if (!present) {
    next = config.plugin ? applyModify(next, ["plugin", -1], pluginPath) : applyModify(next, ["plugin"], [pluginPath]);
  }
  if (enabled[TUI_PLUGIN_ID] === false) {
    next = applyModify(next, ["plugin_enabled", TUI_PLUGIN_ID], true);
  }
  if (next === original) return { changed: false, configPath };
  parseJsonc(next);
  await mkdir4(path4.dirname(configPath), { recursive: true });
  await writeFile4(configPath, next, "utf8");
  return { changed: true, configPath };
}
async function uninstallTarget({ configDir, tuiConfig = null, stateDir = null, locked = false }) {
  configDir = path4.resolve(configDir);
  const paths = [.../* @__PURE__ */ new Set([
    ...["opencode.json", "opencode.jsonc", "tui.json", "tui.jsonc"].map((name) => path4.join(configDir, name)),
    ...tuiConfig ? [path4.resolve(tuiConfig)] : []
  ])];
  const layers = await Promise.all(paths.map(loadConfig));
  const stateDirs = /* @__PURE__ */ new Set([path4.resolve(stateDir || process.env.OPENCODE_TARGET_STATE_DIR || (process.platform === "win32" ? path4.join(process.env.LOCALAPPDATA || path4.join(os.homedir(), "AppData", "Local"), "opencode-target") : path4.join(process.env.XDG_STATE_HOME || path4.join(os.homedir(), ".local", "state"), "opencode-target")))]);
  const writes = [];
  for (const layer of layers) {
    let next = layer.original;
    const entries = layer.config.plugin || [];
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      const name = Array.isArray(entry) ? entry[0] : entry;
      const isServer = typeof name === "string" && (name === "opencode-target" || name.startsWith("opencode-target@") || (name.startsWith("file:") ? fileURLToPath(name) : path4.resolve(path4.dirname(layer.configPath), name)) === path4.join(configDir, "plugins", "target.js"));
      if (!isServer && !isTargetPlugin(entry, layer.configPath, configDir)) continue;
      if (Array.isArray(entry) && entry[1]?.state_dir) stateDirs.add(path4.resolve(entry[1].state_dir));
      next = applyModify(next, ["plugin", index], void 0);
    }
    for (const id of ["opencode-target", TUI_PLUGIN_ID]) {
      if (Object.hasOwn(layer.config.plugin_enabled || {}, id)) next = applyModify(next, ["plugin_enabled", id], void 0);
    }
    if (next !== layer.original) writes.push({ configPath: layer.configPath, text: next });
  }
  for (const dir of stateDirs) {
    if (dir === path4.parse(dir).root || dir === configDir || dir === os.homedir() || paths.some((file) => file === dir || file.startsWith(dir + path4.sep))) {
      throw new Error(`Refusing to remove unsafe state directory: ${dir}`);
    }
  }
  for (const write of writes) await writeFile4(write.configPath, write.text, "utf8");
  await rm3(path4.join(configDir, "plugins", "target.js"), { force: true });
  await rm3(path4.join(configDir, "tui-plugins", "target.js"), { force: true });
  for (const dir of stateDirs) await rm3(dir, { recursive: true, force: true });
  await (locked ? registerComponentLocked : registerComponent)(configDir, "target", null);
}
async function installTargetFiles({ configDir, root, tuiConfig = null, uninstall = false, stateDir = null, upstream, hostInstaller = installCoordinatedHostLocked }) {
  configDir = path4.resolve(configDir);
  return withHostLock(configDir, async () => {
    const owned = ["opencode.json", "opencode.jsonc", "tui.json", "tui.jsonc", "plugins/target.js", "tui-plugins/target.js", "target/package.json", "host-components.json"];
    if (tuiConfig) owned.push(path4.resolve(tuiConfig));
    const snapshots = [];
    for (const file of [...new Set(owned.map((file2) => path4.resolve(configDir, file2)))]) {
      try {
        const info = await lstat3(file);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Unsafe installer file: ${file}`);
        snapshots.push({ file, bytes: await readFile4(file) });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        snapshots.push({ file, bytes: null });
      }
    }
    try {
      let legacyTargetHost = false;
      try {
        const manifest2 = JSON.parse(await readFile4(path4.join(configDir, "host-components.json"), "utf8"));
        legacyTargetHost = /\+target\./.test(manifest2.host?.version || "");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (uninstall) {
        const quarantine = path4.join(configDir, `.target-state-transition-${process.pid}`);
        await uninstallTarget({ configDir, tuiConfig, stateDir: quarantine, locked: true });
      } else {
        for (const [source, destination] of [["target.js", "plugins/target.js"], ["target-tui.js", "tui-plugins/target.js"]]) {
          await mkdir4(path4.dirname(path4.join(configDir, destination)), { recursive: true });
          await copyFile2(path4.join(root, "dist", source), path4.join(configDir, destination));
        }
        await configureTuiConfig({ configDir, tuiConfig });
        const version = true ? "0.5.0" : JSON.parse(await readFile4(path4.join(root, "package.json"), "utf8")).version;
        await mkdir4(path4.join(configDir, "target"), { recursive: true });
        await writeFile4(path4.join(configDir, "target/package.json"), JSON.stringify({ name: "opencode-target", version }) + "\n");
        await registerComponentLocked(configDir, "target", { version, requiresHost: false, files: ["plugins/target.js", "tui-plugins/target.js", "target/package.json"], packageFile: "target/package.json", registration: "opencode-target" });
      }
      if (legacyTargetHost) await hostInstaller(configDir, upstream);
      if (uninstall) {
        await rm3(path4.join(configDir, "target/package.json"), { force: true });
        await uninstallTarget({ configDir, tuiConfig, stateDir, locked: true });
      }
    } catch (error) {
      const failures = [];
      for (const snapshot of snapshots.reverse()) {
        try {
          if (snapshot.bytes === null) await rm3(snapshot.file, { force: true });
          else await writeFile4(snapshot.file, snapshot.bytes);
        } catch (rollbackError) {
          failures.push(rollbackError);
        }
      }
      if (failures.length) throw new AggregateError([error, ...failures], "Target installation rollback incomplete");
      throw error;
    }
  });
}
if (process.argv[1] && path4.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? null : args[index + 1];
  };
  const configDir = value("--config-dir") || process.env.OPENCODE_CONFIG_DIR || path4.join(process.env.XDG_CONFIG_HOME || path4.join(os.homedir(), ".config"), "opencode");
  if (args.includes("--install-files") || args.includes("--uninstall")) {
    await installTargetFiles({ configDir, root: path4.resolve(path4.dirname(fileURLToPath(import.meta.url)), ".."), tuiConfig: value("--tui-config") || process.env.OPENCODE_TUI_CONFIG || null, uninstall: args.includes("--uninstall"), stateDir: value("--state-dir"), upstream: value("--upstream") || void 0 });
    console.log(`Reconciled OpenCode Target and host in ${configDir}`);
  } else if (args.includes("--uninstall")) {
    await uninstallTarget({ configDir, tuiConfig: value("--tui-config") || process.env.OPENCODE_TUI_CONFIG || null, stateDir: value("--state-dir") });
    console.log(`Removed OpenCode Target files, registrations and saved state from ${configDir}`);
  } else {
    const result = await configureTuiConfig({ configDir, tuiConfig: value("--tui-config") || process.env.OPENCODE_TUI_CONFIG || null });
    const version = true ? "0.5.0" : JSON.parse(await readFile4(new URL("./package.json", import.meta.url), "utf8")).version;
    await registerComponent(path4.resolve(configDir), "target", { version, files: ["plugins/target.js", "tui-plugins/target.js"] });
    console.log(`${result.changed ? "Configured" : "Already configured"} TUI Target plugin in ${result.configPath}`);
  }
}
export {
  TUI_PLUGIN_ID,
  configureTuiConfig,
  installTargetFiles,
  parseJsonc,
  selectTuiConfigPath,
  uninstallTarget
};
