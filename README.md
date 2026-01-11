# Mouse Recorder & Auto-Clicker

A Playwright-based tool for recording and replaying mouse actions (clicks, drags) on web pages, including support for iframes and network emulation.

## Features

- **Session Persistence**: Login once per website, sessions are automatically saved and restored
- **Mouse Recording**: Record all mouse clicks and drag operations with visual feedback
- **Canvas & Iframe Support**: Properly handles canvas elements and iframes (including cross-origin)
- **Visual Click Effects**: See ripple animations on every click during recording and playback
- **Network Simulation**: Simulate packet loss for testing offline scenarios
- **Post-Replay Automation**: Automatically runs custom scripts and reloads pages after replay
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Configurable**: Customize timeouts and scripts via config file

## Installation

### Option 1: Run from Source

```bash
npm install
npm start
```

### Option 2: Use Executable

Download the pre-built executable for your platform from releases.

## Browser Setup

The application can use either system Chrome or Playwright's Chromium:

### Option A: Use System Chrome (Recommended - No additional setup)

Set the `CHROME_PATH` environment variable to point to your Chrome installation:

**Windows:**
```batch
set CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
autorefresh-win.exe
```

Or create a launcher script `run.bat`:
```batch
@echo off
set CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
autorefresh-win.exe
pause
```

**macOS:**
```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
./autorefresh-mac
```

**Linux:**
```bash
export CHROME_PATH="/usr/bin/google-chrome"
./autorefresh-linux
```

### Option B: Use Playwright's Chromium

If `CHROME_PATH` is not set, the application uses Playwright's bundled Chromium.

**First-time setup:**
```bash
npx playwright install chromium
```

Note: This requires Node.js/npm to be installed.

## Configuration

Create a `config.json` file to customize settings (optional):

```json
{
  "postReplayScript": "./post-replay.sh",
  "postReplayWaitTime": 6000,
  "postReloadWaitTime": 8000
}
```

**Configuration Options:**

- `postReplayScript`: Path to script to run after replay
  - Windows: use `.bat` or `.cmd` file (default: `./post-replay.bat`)
  - macOS/Linux: use `.sh` file (default: `./post-replay.sh`)
- `postReplayWaitTime`: Wait time (ms) before running post-replay script (default: 6000)
- `postReloadWaitTime`: Wait time (ms) after page reload (default: 8000)

See `config.json.example` for reference.

## Usage

### Controls

```
s - Start/Restart recording
f - Finish recording
r - Replay recorded actions
l - Load a recording from file
p - Enable packet loss (during recording or replay)
n - Restore network (disable packet loss)
x - Cancel replay loop / post-replay sequence
q - Quit
```

### Basic Workflow

1. **Start the application**
   ```bash
   npm start
   # or
   ./autorefresh-win.exe
   ```

2. **Enter website URL** when prompted

3. **Start recording** - Press `s`
   - Red "🔴 RECORDING" badge appears

4. **Perform actions** - Click or drag on the page (including canvas/iframes)
   - Red ripple = Clicks on regular elements
   - Green ripple = Clicks on canvas elements

5. **Stop recording** - Press `f`
   - Recording is automatically saved to `recordings/` folder

6. **Replay** - Press `r`
   - Enter number of loops when prompted
   - Actions will replay at the same timing as recorded
   - Blue ripple shows replay clicks

### Visual Feedback

- **Recording Indicator**: Red "🔴 RECORDING" badge appears in top-right when recording
- **Packet Loss Indicator**: Yellow "⚠️ PACKET LOSS" badge when network emulation is active
- **Click Effects**:
  - Red ripple = Recording clicks on regular elements
  - Green ripple = Recording clicks on canvas elements
  - Blue/Green ripple = Replay clicks

### Advanced Features

#### Network Emulation

During recording or replay, you can simulate network issues:

- Press `p` - Enable 100% packet loss (blocks API requests)
  - During recording: Adds "enable packet loss" to the sequence
  - Outside recording: Immediately enables packet loss
- Press `n` - Restore normal network
  - During recording: Adds "restore network" to the sequence
  - Outside recording: Immediately disables packet loss

**Example: Recording Network Failure Mid-Action**

1. Press `s` to start recording
2. Click at position A
3. Click at position B
4. **Press `p`** - Records "enable packet loss" action
5. Click at position C (will happen with no network during replay)
6. **Press `n`** - Records "restore network" action
7. Press `f` to finish

Replay sequence: `A → B → [PACKET LOSS ON] → C → [NETWORK RESTORED]`

#### Post-Replay Script

After replay completes, the application can:
1. Wait for configurable time
2. Execute a custom script
3. Restore network
4. Reload the page

Press `x` during the wait to cancel the post-replay sequence.

**Example post-replay script:**

**Windows (post-replay.bat):**
```batch
@echo off
echo Running post-replay cleanup...
REM Toggle WiFi
netsh interface set interface "Wi-Fi" disabled
timeout /t 2 /nobreak >nul
netsh interface set interface "Wi-Fi" enabled
```

**macOS (post-replay.sh):**
```bash
#!/bin/bash
echo "Running post-replay cleanup..."
# Toggle WiFi
networksetup -setairportpower en0 off
sleep 2
networksetup -setairportpower en0 on
```

**Linux (post-replay.sh):**
```bash
#!/bin/bash
echo "Running post-replay cleanup..."
# Toggle WiFi (adjust interface name as needed)
sudo nmcli networking off
sleep 2
sudo nmcli networking on
```

Make the script executable on macOS/Linux:
```bash
chmod +x post-replay.sh
```

## Building Executables

To create standalone executables:

```bash
# Install dependencies
npm install

# Build for specific platform
npm run build:win    # Windows (.exe)
npm run build:mac    # macOS
npm run build:linux  # Linux

# Or build for all platforms
npm run build:all
```

Executables will be created in the `dist/` folder.

## Directory Structure

```
.
├── sessions/          # Browser session data (cookies, storage)
├── recordings/        # Saved recordings (.json files)
├── config.json        # Optional configuration file
├── config.json.example # Example configuration
├── post-replay.sh     # Optional post-replay script (macOS/Linux)
├── post-replay.bat    # Optional post-replay script (Windows)
└── index.js           # Main application
```

## Use Cases

- **Network Failure Testing**: Simulate network dropping at exact moments during user interactions
- **Canvas Applications**: Test drawing apps, games, or interactive visualizations
- **Iframe Testing**: Test applications with embedded content (ads, widgets, etc.)
- **Automation**: Automate repetitive tasks on web applications
- **QA Testing**: Record test scenarios and replay them consistently

## Troubleshooting

### Browser not found

If you see "Chromium browser not found":

1. **Option 1**: Set `CHROME_PATH` to your Chrome installation (see Browser Setup above)
2. **Option 2**: Install Playwright browsers: `npx playwright install chromium`

### Clicks not working on certain websites

Some websites use iframes or have special click handling. The recorder:
- Automatically detects and handles iframes (including cross-origin)
- Uses real browser events via CDP for maximum compatibility
- Records frame-relative coordinates and converts them during replay

### Clicks landing in wrong position

If clicks land "higher" or offset during replay:
- Make sure you're using the latest version
- The issue was fixed to properly handle iframe offsets
- Delete old recordings and re-record

### Network emulation not working in iframes

The application applies network emulation to all frames including iframes. If it's not working:
- Make sure you're using the latest version
- Check browser console (F12) for errors

### Post-replay script not executing

**Windows:**
- Make sure the script path uses `.bat` or `.cmd` extension
- Run the application as Administrator if the script needs elevated privileges
- Check the script exists at the configured path

**macOS/Linux:**
- Make the script executable: `chmod +x post-replay.sh`
- Check script path in `config.json` or use default `./post-replay.sh`
- Ensure the script has proper shebang: `#!/bin/bash`

### Finding Chrome Path

**Windows:**
- Default: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- Or: `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`

**macOS:**
- Default: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

**Linux:**
- Try: `/usr/bin/google-chrome` or `/usr/bin/chromium-browser`

## License

ISC
