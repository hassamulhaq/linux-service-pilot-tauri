# Linux Service Pilot

A fast, native desktop dashboard for managing systemd services on Ubuntu/Linux. Built with Tauri + Rust + React.

![Main screen](docs/screenshots/main_screen.webp)

## Features

- **Service dashboard** — start, stop, restart, view logs in one click
- **System scan** — discover installed systemd units; optional toggle to include core/system services
- **Bulk actions** — multi-select services to start/stop/restart/remove together
- **Real-time status** — polls `systemctl` every 3 seconds; reflects changes made from the terminal
- **Search + group filter** — quickly locate services across large lists
- **Logs viewer** — last 300 lines from `journalctl -u <unit>`
- **Custom services** — add any systemd unit (e.g. `php8.3-fpm`, `supervisor`) with auto-grouping
- **Sudo keyring** — optionally store sudo password in OS keyring (libsecret/kwallet) to skip polkit prompts; falls back to pkexec
- **System-service guard** — units matching core patterns (systemd-, dbus, polkit, gdm, snap, etc.) are flagged and cannot be removed
- **Dark / light theme**

## Screenshots

| | |
|---|---|
| ![Dashboard](docs/screenshots/sc_00.webp) | ![Scan dialog](docs/screenshots/sc_01.webp) |
| ![Logs viewer](docs/screenshots/sc_02.webp) | ![Settings — sudo keyring](docs/screenshots/sc_03.webp) |
| ![Add service](docs/screenshots/sc_04.webp) | |

## Stack

| Layer | Tech |
|---|---|
| UI | React 19, TypeScript, Vite, Tailwind v4, shadcn/ui (Radix-Sera), Lucide |
| Runtime | Tauri 2 |
| Backend | Rust |
| OS integration | `systemctl`, `journalctl`, `sudo -S` / `pkexec`, OS keyring |

## Architecture

```
React UI
   ↓ invoke()
Tauri commands (Rust)
   ↓
systemctl / journalctl / OS keyring
```

Service actions are whitelisted: only units registered in the user config can be passed to `systemctl`. Unit names are validated against a strict character set to prevent injection.

## Development

```bash
pnpm install
pnpm tauri dev
```

Production build:

```bash
pnpm tauri build
```

Config is persisted at `~/.config/linux-service-pilot/services.json`.

## Author

Hassam Ul Haq — [github.com/hassamulhaq](https://github.com/hassamulhaq)
