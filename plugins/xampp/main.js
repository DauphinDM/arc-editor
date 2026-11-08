export function activate(api) {
  if (api.platform !== "linux") return;
  api.registerAction({
    id: "toggle",
    label: "XAMPP",
    title: "Start or stop XAMPP server",
    icon: "server",
    onClick: async () => {
      const running = await api.process.isRunning(["httpd", "mysqld", "proftpd"]);
      api.openTerminal(`sudo /opt/lampp/lampp ${running ? "stop" : "start"}`);
    },
  });
}
