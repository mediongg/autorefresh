# Mouse Recorder & Automation Tool

A Playwright-based tool for recording and replaying mouse interactions on websites with persistent session management.

## Features

- **Session Persistence**: Login once per website, sessions are automatically saved and restored
- **Mouse Recording**: Record all mouse clicks and drag operations with visual feedback
- **Canvas Support**: Detects and properly records interactions on canvas elements
- **Visual Click Effects**: See ripple animations on every click during recording and playback
- **Playback**: Replay recorded actions with timing preservation
- **Network Simulation**: Record packet loss actions into your sequence for precise network failure testing
- **Post-Replay Automation**: Automatically waits 10 seconds, runs a custom shell script, then reloads the page
- **Multi-URL Support**: Manage sessions for multiple websites independently

## Installation

```bash
npm install
npx playwright install chromium
```

## Usage

Start the application:

```bash
npm start
```

### Workflow

1. **Enter URL**: When prompted, enter the website URL you want to automate
2. **Login** (if needed): The browser will open maximized - login if required. Your session will be saved automatically
3. **Use Keyboard Controls**:
   - Press `s` - Start/restart recording (clears previous recording, shows red "RECORDING" badge)
   - Press `f` - Finish and save current recording
   - Press `r` - Replay recorded actions
   - Press `p` - **During recording**: Records "enable packet loss" action into sequence
   - Press `n` - **During recording**: Records "restore network" action into sequence
   - Press `p`/`n` - **Outside recording**: Immediately enables/disables packet loss
   - Press `x` - **During post-replay wait**: Cancel script execution and page reload
   - Press `q` - Quit and save session

### Visual Feedback

- **Recording Indicator**: Red "🔴 RECORDING" badge appears in top-right when recording
- **Click Effects**:
  - Red ripple = Recording clicks on regular elements
  - Green ripple = Clicks on canvas elements
  - Blue ripple = Replay clicks on regular elements

### How It Works

- **Sessions**: Each URL's login state is saved in the `sessions/` folder using an MD5 hash of the URL
- **Recordings**: Captured mouse actions are saved in the `recordings/` folder as JSON files with canvas detection
- **Recording**: Captures mousedown, mousemove, mouseup, and click events with coordinates and target element info
- **Playback**: Replays actions with original timing (capped at 1 second max delay between actions)
- **Network Simulation**: Uses Chrome DevTools Protocol to emulate 100% packet loss for testing offline scenarios
- **Post-Replay**: Waits 10s → Runs script → Restores network → Reloads page (cancellable with `x`)

## Project Structure

```
autorefresh/
├── index.js           # Main application
├── post-replay.sh     # Custom script executed after each replay
├── sessions/          # Stored browser sessions
├── recordings/        # Saved mouse recordings
├── package.json
└── README.md
```

## Use Cases

- **Mid-Action Network Failure Testing**: Press `p` during replay to simulate network dropping at exact moments
- **Offline Testing**: Record user interactions, then replay and trigger packet loss to test how your app handles network failures
- **Canvas Applications**: Test drawing apps, games, or interactive visualizations
- **Automation**: Automate repetitive tasks on web applications
- **QA Testing**: Record test scenarios and replay them consistently

### Example: Recording Network Failure Mid-Action

**Scenario**: Test how your canvas app handles network failure between specific actions

1. Press `s` to start recording
2. Perform action 1: Click at position A
3. Perform action 2: Click at position B
4. Perform action 3: Click at position C
5. **Press `p`** - This records "enable packet loss" into the sequence
6. Perform action 4: Click at position D (this will happen with no network during replay)
7. Perform action 5: Click at position E
8. **Press `n`** - This records "restore network" into the sequence
9. Press `f` to finish recording

Now when you press `r` to replay:
- Actions 1, 2, 3 execute normally
- Packet loss is automatically enabled
- Actions 4, 5 execute with no network
- Network is automatically restored

**The recorded sequence**: `a1 → a2 → a3 → [PACKET LOSS ON] → a4 → a5 → [NETWORK RESTORED]`

## Post-Replay Automation

After every replay completes, the tool automatically:

1. **Waits 10 seconds** - Gives your app time to settle/respond (press `x` to cancel!)
2. **Runs `post-replay.sh`** - Execute custom shell commands (if the file exists)
3. **Restores network** - Disables packet loss (resets to no throttling)
4. **Reloads the page** - Resets the app state for the next replay

### Cancelling Post-Replay

During the 10-second wait, press `x` to cancel the entire post-replay sequence (skips script execution and page reload). Useful when you want to manually inspect the page state after replay.

### Customizing the Post-Replay Script

Edit `post-replay.sh` to add your custom actions:

```bash
#!/bin/bash

# Example: Log to a file
echo "Replay completed at $(date)" >> replay-log.txt

# Example: Check application logs
tail -n 20 /var/log/myapp.log

# Example: Take a screenshot
# screencapture -x screenshot-$(date +%s).png

# Example: Send webhook notification
# curl -X POST https://hooks.example.com/replay-complete
```

### Adjusting Wait Time

To change the 10-second wait time, modify `index.js`:

```javascript
this.postReplayWaitTime = 15000;  // 15 seconds
```

## Next Steps (TBD)

- Configurable wait time between repeats
- Insert custom actions between replays
- Loop/repeat count configuration
- Adjustable packet loss percentage (0-100%)
- Network latency simulation
