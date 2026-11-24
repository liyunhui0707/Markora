// Exercise the same disclosure as a user when a command is tucked away.
async function workspaceControl(page, id) {
  const control = page.locator('#' + id);
  if (await control.isVisible()) return control;
  const container = await control.evaluate(node =>
    node.closest('#file-actions-content') ? 'menu' : node.closest('#format-toolbar') ? 'format' : null);
  if (container) {
    const menu = page.locator('#file-actions');
    if (!(await menu.evaluate(node => node.open))) await page.locator('#file-actions-toggle').click();
    if (container === 'format') await page.locator('#show-format-tools').click();
  }
  return control;
}

async function clickWorkspaceControl(page, id) {
  await (await workspaceControl(page, id)).click();
}

module.exports = { workspaceControl, clickWorkspaceControl };
