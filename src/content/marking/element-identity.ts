export function readElementId(element: Element): string {
  const attributeId = element.getAttribute("id");
  if (attributeId !== null) {
    return attributeId;
  }
  return typeof element.id === "string" ? element.id : "";
}
