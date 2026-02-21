const versionsElement = document.getElementById('versions');

if (versionsElement && window.appInfo) {
  const { node, chrome, electron } = window.appInfo.versions;
  versionsElement.textContent = `Node: ${node} | Chrome: ${chrome} | Electron: ${electron}`;
}
