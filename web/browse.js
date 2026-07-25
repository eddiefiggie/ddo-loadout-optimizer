// Item browser. U1: minimal count render so the shell loads cleanly.
// U5 replaces this with the full searchable/filterable view.

window.App.ready((dataset) => {
  const status = document.getElementById("browse-status");
  if (status) {
    status.textContent = `Loaded ${dataset.items.length} items. Search & filters coming in the browse view (U5).`;
  }
});
