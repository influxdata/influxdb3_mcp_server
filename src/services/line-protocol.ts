/** Lines that carry a record: not blank and not a `#` comment. */
export function lineProtocolRecords(lineProtocol: string): string[] {
  return lineProtocol
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
}

function unquotedUnescapedSections(line: string): string[] {
  const sections: string[] = [];
  let current = "";
  let inQuotedFieldValue = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\" && i + 1 < line.length) {
      current += char + line[i + 1];
      i++;
    } else if (char === '"') {
      inQuotedFieldValue = !inQuotedFieldValue;
      current += char;
    } else if (char === " " && !inQuotedFieldValue) {
      if (current !== "") sections.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current !== "") sections.push(current);
  return sections;
}

export function hasExplicitTimestamp(line: string): boolean {
  const sections = unquotedUnescapedSections(line.trim());
  return sections.length >= 3 && /^-?\d+$/u.test(sections[sections.length - 1]);
}
