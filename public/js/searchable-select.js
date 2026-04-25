(() => {
  const STYLE_ID = 'searchable-select-style';
  const INSTANCE_KEY = Symbol('searchableSelectInstance');

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .searchable-select {
        position: relative;
        width: 100%;
      }

      .searchable-select-input {
        width: 100%;
        box-sizing: border-box;
      }

      .searchable-select-native {
        display: none !important;
      }

      .searchable-select-dropdown {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        right: 0;
        z-index: 1000;
        background: #fff;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
        max-height: 240px;
        overflow-y: auto;
        display: none;
      }

      .searchable-select.open .searchable-select-dropdown {
        display: block;
      }

      .searchable-select-option,
      .searchable-select-empty {
        padding: 10px 12px;
        font-size: 16px;
        line-height: 1.5;
      }

      .searchable-select-option {
        cursor: pointer;
      }

      .searchable-select-option:hover,
      .searchable-select-option.active {
        background: #eef2f7;
      }

      .searchable-select-empty {
        color: #7b8794;
      }
    `;

    document.head.appendChild(style);
  }

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getOptionData(select) {
    return Array.from(select.options).map((option, index) => ({
      value: option.value,
      label: option.textContent || '',
      disabled: option.disabled,
      selected: option.selected,
      index
    }));
  }

  function getSelectedLabel(select) {
    const option = select.options[select.selectedIndex];
    return option ? option.textContent || '' : '';
  }

  function syncInputValue(instance) {
    instance.input.value = getSelectedLabel(instance.select);
    instance.input.disabled = instance.select.disabled;
  }

  function closeDropdown(instance, restoreSelection = true) {
    instance.wrapper.classList.remove('open');
    instance.activeIndex = -1;

    if (restoreSelection) {
      syncInputValue(instance);
    }
  }

  function selectOption(instance, optionData) {
    instance.select.value = optionData.value;
    instance.select.dispatchEvent(new Event('change', { bubbles: true }));
    instance.select.dispatchEvent(new Event('input', { bubbles: true }));
    syncInputValue(instance);
    closeDropdown(instance, false);
  }

  function renderDropdown(instance, filterValue = '') {
    const filterText = normalizeText(filterValue);
    const options = getOptionData(instance.select).filter((option) => {
      if (option.disabled) {
        return false;
      }

      return normalizeText(option.label).includes(filterText);
    });

    instance.dropdown.innerHTML = '';
    instance.filteredOptions = options;

    if (!options.length) {
      const emptyState = document.createElement('div');
      emptyState.className = 'searchable-select-empty';
      emptyState.textContent = 'لا توجد نتائج';
      instance.dropdown.appendChild(emptyState);
      return;
    }

    options.forEach((optionData, index) => {
      const optionButton = document.createElement('div');
      optionButton.className = 'searchable-select-option';
      optionButton.textContent = optionData.label;
      optionButton.dataset.index = String(index);

      if (index === instance.activeIndex) {
        optionButton.classList.add('active');
      }

      optionButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });

      optionButton.addEventListener('click', () => {
        selectOption(instance, optionData);
      });

      instance.dropdown.appendChild(optionButton);
    });
  }

  function openDropdown(instance) {
    instance.wrapper.classList.add('open');
    instance.activeIndex = -1;
    renderDropdown(instance, '');
    instance.input.select();
  }

  function patchSelectValueSync(select) {
    if (select.dataset.searchablePatched === 'true') {
      return;
    }

    const prototype = Object.getPrototypeOf(select);
    const valueDescriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    const selectedIndexDescriptor = Object.getOwnPropertyDescriptor(prototype, 'selectedIndex');

    if (valueDescriptor?.configurable) {
      Object.defineProperty(select, 'value', {
        get() {
          return valueDescriptor.get.call(this);
        },
        set(nextValue) {
          valueDescriptor.set.call(this, nextValue);

          if (this[INSTANCE_KEY]) {
            syncInputValue(this[INSTANCE_KEY]);
            renderDropdown(this[INSTANCE_KEY], this[INSTANCE_KEY].input.value);
          }
        },
        configurable: true,
        enumerable: valueDescriptor.enumerable
      });
    }

    if (selectedIndexDescriptor?.configurable) {
      Object.defineProperty(select, 'selectedIndex', {
        get() {
          return selectedIndexDescriptor.get.call(this);
        },
        set(nextValue) {
          selectedIndexDescriptor.set.call(this, nextValue);

          if (this[INSTANCE_KEY]) {
            syncInputValue(this[INSTANCE_KEY]);
            renderDropdown(this[INSTANCE_KEY], this[INSTANCE_KEY].input.value);
          }
        },
        configurable: true,
        enumerable: selectedIndexDescriptor.enumerable
      });
    }

    select.dataset.searchablePatched = 'true';
  }

  function enhanceSelect(select) {
    if (!select || select.dataset.searchableEnhanced === 'true') {
      return;
    }

    if (select.multiple || Number(select.size || 0) > 1) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'searchable-select';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = select.className;
    input.classList.add('searchable-select-input');
    input.autocomplete = 'off';

    const dropdown = document.createElement('div');
    dropdown.className = 'searchable-select-dropdown';

    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    wrapper.appendChild(input);
    wrapper.appendChild(dropdown);

    select.classList.add('searchable-select-native');

    const instance = {
      select,
      wrapper,
      input,
      dropdown,
      filteredOptions: [],
      activeIndex: -1
    };

    select[INSTANCE_KEY] = instance;
    select.dataset.searchableEnhanced = 'true';
    patchSelectValueSync(select);
    syncInputValue(instance);

    input.addEventListener('focus', () => {
      openDropdown(instance);
    });

    input.addEventListener('click', () => {
      openDropdown(instance);
    });

    input.addEventListener('input', () => {
      if (!instance.wrapper.classList.contains('open')) {
        instance.wrapper.classList.add('open');
      }

      instance.activeIndex = -1;
      renderDropdown(instance, input.value);
    });

    input.addEventListener('keydown', (event) => {
      if (!instance.wrapper.classList.contains('open') && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        openDropdown(instance);
      }

      if (!instance.filteredOptions.length && event.key === 'Escape') {
        closeDropdown(instance);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        instance.activeIndex = Math.min(instance.activeIndex + 1, instance.filteredOptions.length - 1);
        renderDropdown(instance, input.value);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        instance.activeIndex = Math.max(instance.activeIndex - 1, 0);
        renderDropdown(instance, input.value);
        return;
      }

      if (event.key === 'Enter') {
        if (instance.activeIndex >= 0 && instance.filteredOptions[instance.activeIndex]) {
          event.preventDefault();
          selectOption(instance, instance.filteredOptions[instance.activeIndex]);
        }
        return;
      }

      if (event.key === 'Escape') {
        closeDropdown(instance);
      }
    });

    select.addEventListener('change', () => {
      syncInputValue(instance);
    });

    const observer = new MutationObserver(() => {
      syncInputValue(instance);
      renderDropdown(instance, instance.wrapper.classList.contains('open') ? input.value : '');
    });

    observer.observe(select, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });
  }

  function enhanceAll(root = document) {
    root.querySelectorAll('select').forEach((select) => {
      enhanceSelect(select);
    });
  }

  function handleDocumentClick(event) {
    document.querySelectorAll('select[data-searchable-enhanced="true"]').forEach((select) => {
      const instance = select[INSTANCE_KEY];

      if (!instance) {
        return;
      }

      if (!instance.wrapper.contains(event.target)) {
        closeDropdown(instance);
      }
    });
  }

  function boot() {
    ensureStyles();
    enhanceAll();

    const bodyObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }

          if (node.matches('select')) {
            enhanceSelect(node);
          }

          if (node.querySelectorAll) {
            enhanceAll(node);
          }
        });
      });
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    document.addEventListener('click', handleDocumentClick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
