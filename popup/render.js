export function renderList(listEl, items, emptyText, onRemove) {
  listEl.textContent = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyText;
    listEl.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = item;
    const button = document.createElement("button");
    button.textContent = "Remove";
    button.addEventListener("click", () => onRemove(item));
    li.appendChild(text);
    li.appendChild(button);
    listEl.appendChild(li);
  });
}

export function renderExcludeList(listEl, items, emptyText, onView, onRemove) {
  listEl.textContent = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyText;
    listEl.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    const label = item.text || item.xpath || "";
    text.textContent = label;
    text.title = label;
    const viewButton = document.createElement("button");
    viewButton.textContent = "View";
    viewButton.addEventListener("click", () => onView(item.xpath));
    const removeButton = document.createElement("button");
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => onRemove(item.xpath));
    li.appendChild(text);
    li.appendChild(viewButton);
    li.appendChild(removeButton);
    listEl.appendChild(li);
  });
}

export function renderIncludeList(listEl, items, emptyText, onView, onRemove) {
  renderExcludeList(listEl, items, emptyText, onView, onRemove);
}

export function renderHeadingDefaults(listEl, items, emptyText, onToggle) {
  listEl.textContent = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyText;
    listEl.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = item.text;
    text.title = item.text;
    const status = document.createElement("span");
    status.className = "status";
    status.textContent = item.excluded ? "Excluded" : "Included";
    const viewButton = document.createElement("button");
    viewButton.textContent = "View";
    viewButton.addEventListener("click", () => onToggle(item, "view"));
    const button = document.createElement("button");
    button.textContent = item.excluded ? "Include" : "Exclude";
    button.addEventListener("click", () => onToggle(item, "toggle"));
    li.appendChild(text);
    li.appendChild(status);
    li.appendChild(viewButton);
    li.appendChild(button);
    listEl.appendChild(li);
  });
}

export function renderMarkedPages(listEl, items, emptyText, currentPageUrl, onNavigate) {
  listEl.textContent = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyText;
    listEl.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    const title = document.createElement("span");
    title.className = "page-title";
    title.textContent = item.title;
    title.title = item.title;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent =
      item.count === 0 ? "No marks" : item.count === 1 ? "1 mark" : `${item.count} marks`;
    const button = document.createElement("button");
    button.textContent = "Navigate";
    const isCurrentPage = item.url === currentPageUrl;
    button.disabled = isCurrentPage;
    button.addEventListener("click", () => onNavigate(item.url));
    li.appendChild(title);
    li.appendChild(count);
    li.appendChild(button);
    listEl.appendChild(li);
  });
}

export function renderPatternSelect(selectEl, options, selectedValue) {
  if (!selectEl) {
    return;
  }
  selectEl.textContent = "";
  if (!options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No patterns available";
    selectEl.appendChild(option);
    selectEl.value = "";
    return;
  }
  options.forEach((optionItem) => {
    const option = document.createElement("option");
    option.value = optionItem.value;
    option.textContent = optionItem.label;
    option.title = optionItem.value;
    selectEl.appendChild(option);
  });
  selectEl.value = selectedValue || options[0].value;
  selectEl.title = selectedValue || options[0].value;
}

export function renderSelectOptions(selectEl, options, selectedValue, placeholder) {
  if (!selectEl) {
    return;
  }
  selectEl.textContent = "";
  if (!options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder || "No options available";
    selectEl.appendChild(option);
    selectEl.value = "";
    selectEl.title = option.textContent;
    return;
  }
  if (placeholder) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    selectEl.appendChild(option);
  }
  options.forEach((optionItem) => {
    const option = document.createElement("option");
    option.value = optionItem.value;
    option.textContent = optionItem.label || optionItem.value;
    option.title = optionItem.title || optionItem.value;
    selectEl.appendChild(option);
  });
  if (selectedValue && options.some((item) => item.value === selectedValue)) {
    selectEl.value = selectedValue;
    selectEl.title = selectedValue;
  } else {
    selectEl.value = "";
    selectEl.title = placeholder || "";
  }
}
