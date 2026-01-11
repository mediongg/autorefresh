import { chromium } from 'playwright';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class MouseRecorder {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.recordedActions = [];
    this.isRecording = false;
    this.currentUrl = null;
    this.sessionDir = './sessions';
    this.recordingsDir = './recordings';
    this.postReplayScript = './post-replay.sh';  // Default script path
    this.postReplayWaitTime = 6000;  // 10 seconds in milliseconds
    this.cancelPostReplay = false;  // Flag to cancel post-replay sequence
    this.inputMode = 'normal';
    this.inputBuffer = '';
  }

  getSessionPath(url) {
    // Sanitize URL to create a readable and safe filename
    const sanitizedUrl = url.replace(/[^a-zA-Z0-9.-]/g, '_');
    return path.join(this.sessionDir, `session_${sanitizedUrl}`);
  }

  async start() {
    console.log('\n=== Playwright Mouse Recorder ===\n');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const askUrl = () => {
      return new Promise((resolve) => {
        rl.question('Enter website URL: ', (answer) => {
          rl.close();
          resolve(answer);
        });
      });
    };

    const url = await askUrl();
    let finalUrl = url;

    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl;
    }

    this.currentUrl = finalUrl;
    await this.initBrowser(finalUrl);

    console.log('\n=== Controls ===');
    console.log('Press "s" - Start/Restart recording');
    console.log('Press "f" - Finish recording');
    console.log('Press "r" - Replay recorded actions');
    console.log('Press "l" - Load a recording from a file');
    console.log('Press "p" - Enable packet loss (records during recording!)');
    console.log('Press "n" - Restore network (records during recording!)');
    console.log('Press "x" - Cancel replay loop / post-replay sequence');
    console.log('Press "q" - Quit\n');
    console.log('TIP: Press "p" during recording to insert packet loss into the sequence!');

    this.setupKeyboardListener();
  }

  async initBrowser(url) {
    console.log('\nInitializing browser...');

    this.browser = await chromium.launch({
      headless: false,
      slowMo: 50,
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const sessionPath = this.getSessionPath(url);

    // Context options for maximized window
    const contextOptions = {
      viewport: null, // Disable default viewport to use full window size
      ...(fs.existsSync(sessionPath) && { storageState: sessionPath })
    };

    if (fs.existsSync(sessionPath)) {
      console.log('Loading existing session...');
      this.context = await this.browser.newContext(contextOptions);
    } else {
      console.log('Creating new session...');
      this.context = await this.browser.newContext(contextOptions);
    }

    this.page = await this.context.newPage();

    console.log(`Navigating to ${url}...`);
    await this.page.goto(url);

    console.log('Browser ready!\n');
  }

  setupKeyboardListener() {
    // Ensure stdin is in the correct mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.setEncoding('utf8');
    readline.emitKeypressEvents(process.stdin);

    console.log('[Keyboard listener active - ready for input]');

    process.stdin.on('keypress', async (str, key) => {
      if (!key) return;

      if (key.ctrl && key.name === 'c') {
        await this.cleanup();
        process.exit();
      }

      if (this.inputMode === 'loadingFile') {
        if (key.name === 'return' || key.name === 'enter') {
            await this.finishLoading();
        } else if (key.name === 'c' || key.name === 'escape') {
            this.inputMode = 'normal';
            this.inputBuffer = '';
            process.stdout.write('\nLoad cancelled.\n');
        } else if (key.name === 'backspace') {
            if (this.inputBuffer.length > 0) {
                this.inputBuffer = this.inputBuffer.slice(0, -1);
                process.stdout.write('\b \b'); // Erase character from terminal
            }
        } else if (str && !isNaN(parseInt(str, 10))) { // Check if it's a number
            this.inputBuffer += str;
            process.stdout.write(str);
        }
      } else if (this.inputMode === 'settingReplayLoops') {
        if (key.name === 'return' || key.name === 'enter') {
            let loopCount = parseInt(this.inputBuffer, 10);
            if (isNaN(loopCount) || loopCount <= 0) {
                loopCount = 1;
            }
            this.inputMode = 'normal';
            this.inputBuffer = '';
            process.stdout.write('\n');
            await this.replay(loopCount);
        } else if (key.name === 'c' || key.name === 'escape') {
            this.inputMode = 'normal';
            this.inputBuffer = '';
            process.stdout.write('\nReplay setup cancelled.\n');
        } else if (key.name === 'backspace') {
            if (this.inputBuffer.length > 0) {
                this.inputBuffer = this.inputBuffer.slice(0, -1);
                process.stdout.write('\b \b');
            }
        } else if (str && !isNaN(parseInt(str, 10))) {
            this.inputBuffer += str;
            process.stdout.write(str);
        }
      } else { // Normal mode
        if (key.name === 's') {
          await this.startRecording();
        } else if (key.name === 'f') {
          await this.stopRecording();
        } else if (key.name === 'r') {
          await this.setupReplay();
        } else if (key.name === 'l') {
          await this.loadRecording();
        } else if (key.name === 'p') {
          if (this.isRecording) {
            await this.recordNetworkAction('enablePacketLoss');
          }
          await this.enablePacketLoss();
        } else if (key.name === 'n') {
          if (this.isRecording) {
            await this.recordNetworkAction('disablePacketLoss');
          }
          await this.disablePacketLoss();
        } else if (key.name === 'x') {
          this.cancelPostReplay = true;
          console.log('\n[CANCELLED] Replay loop/sequence cancelled by user');
        } else if (key.name === 'q') {
          await this.cleanup();
          process.exit();
        }
      }
    });

    // Resume stdin so it starts listening
    process.stdin.resume();
  }

  async setupReplay() {
    if (this.recordedActions.length === 0) {
      console.log('\n[ERROR] No recorded actions to replay');
      return;
    }
    process.stdout.write('How many times to repeat the replay? (default: 1): ');
    this.inputMode = 'settingReplayLoops';
    this.inputBuffer = '';
  }


  async loadRecording() {
    console.log('\n--- Load Recording ---');
    let recordings = [];
    try {
      recordings = fs.readdirSync(this.recordingsDir).filter(f => f.endsWith('.json'));
    } catch (error) {
      console.log(`[ERROR] Could not read recordings directory: ${error.message}`);
      return;
    }

    if (recordings.length === 0) {
      console.log('[INFO] No recordings found in the "./recordings" directory.');
      return;
    }

    console.log('Available recordings:');
    recordings.forEach((r, i) => console.log(`  ${i + 1}: ${r}`));

    process.stdout.write('Enter the number of the recording to load (or "c" to cancel): ');
    this.inputMode = 'loadingFile';
    this.inputBuffer = '';
  }

  async finishLoading() {
    this.inputMode = 'normal';
    const choice = this.inputBuffer;
    this.inputBuffer = '';
    process.stdout.write('\n'); // Newline after user input

    const recordings = fs.readdirSync(this.recordingsDir).filter(f => f.endsWith('.json'));
    const index = parseInt(choice, 10) - 1;
    if (isNaN(index) || index < 0 || index >= recordings.length) {
      console.log('[ERROR] Invalid selection.');
      return;
    }

    const filename = recordings[index];
    const filepath = path.join(this.recordingsDir, filename);

    try {
      const data = fs.readFileSync(filepath, 'utf8');
      const parsedData = JSON.parse(data);

      if (Array.isArray(parsedData)) { // Old format
        this.recordedActions = parsedData;
        console.log(`\n[LOADED] Successfully loaded ${this.recordedActions.length} actions from ${filename} (old format).`);
      } else if (parsedData && parsedData.actions) { // New format with metadata
        this.recordedActions = parsedData.actions;
        console.log(`\n[LOADED] Successfully loaded ${this.recordedActions.length} actions from ${filename}.`);
        if(parsedData.metadata && parsedData.metadata.url) {
            console.log(`       Original URL: ${parsedData.metadata.url}`);
        }
      } else {
        console.log('[ERROR] Invalid recording file format.');
        this.recordedActions = [];
        return;
      }
      
      console.log('You can now press "r" to replay the loaded actions.');

    } catch (error) {
      console.log(`[ERROR] Failed to load or parse recording file: ${error.message}`);
      this.recordedActions = [];
    }
  }


  async startRecording() {
    this.recordedActions = [];
    this.isRecording = true;
    console.log('\n[RECORDING STARTED] - All previous recordings cleared');
    console.log('[INFO] Canvas-aware recording active - click and drag on the page');

    try {
      // Add visual recording indicator only to main page
      await this.page.evaluate(() => {
        // Remove old recording indicator
        const oldIndicator = document.getElementById('__mouse_recorder_indicator');
        if (oldIndicator) oldIndicator.remove();

        const indicator = document.createElement('div');
        indicator.id = '__mouse_recorder_indicator';
        indicator.textContent = '🔴 RECORDING';
        indicator.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          background: red;
          color: white;
          padding: 8px 16px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 14px;
          font-weight: bold;
          z-index: 999999;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(indicator);

        // Initialize shared recorder storage
        if (!window.__mouseRecorder) {
          window.__mouseRecorder = {
            actions: [],
            isMouseDown: false,
            startX: 0,
            startY: 0,
            scrollX: 0,
            scrollY: 0
          };
        }
      });

      // Inject recording code into main page and all iframes
      const frames = this.page.frames();
      console.log(`[INFO] Found ${frames.length} frame(s) - injecting listeners into all frames`);

      for (const frame of frames) {
        try {
          await frame.evaluate(() => {
        // Clean up old listeners if they exist
        if (window.__mouseRecorderListeners) {
          const listeners = window.__mouseRecorderListeners;
          document.removeEventListener('mousedown', listeners.mousedown, true);
          document.removeEventListener('mousemove', listeners.mousemove, true);
          document.removeEventListener('mouseup', listeners.mouseup, true);
          document.removeEventListener('click', listeners.click, true);
        }

        // Initialize recorder state
        window.__mouseRecorder = {
          actions: [],
          isMouseDown: false,
          startX: 0,
          startY: 0,
          scrollX: 0,
          scrollY: 0
        };

        // Function to show visual click effect
        const showClickEffect = (x, y, isCanvas = false) => {
          const effect = document.createElement('div');
          effect.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            width: 20px;
            height: 20px;
            margin-left: -10px;
            margin-top: -10px;
            border: 3px solid ${isCanvas ? '#00ff00' : '#ff0000'};
            border-radius: 50%;
            pointer-events: none;
            z-index: 999998;
            animation: clickRipple 0.6s ease-out;
          `;

          // Add CSS animation if not already present
          if (!document.getElementById('__click_effect_style')) {
            const style = document.createElement('style');
            style.id = '__click_effect_style';
            style.textContent = `
              @keyframes clickRipple {
                0% {
                  transform: scale(1);
                  opacity: 1;
                }
                100% {
                  transform: scale(3);
                  opacity: 0;
                }
              }
            `;
            document.head.appendChild(style);
          }

          document.body.appendChild(effect);

          // Remove effect after animation
          setTimeout(() => effect.remove(), 600);
        };

        const recordAction = (type, x, y, isDrag = false, target = null) => {
          const isCanvas = target && target.tagName === 'CANVAS';

          // Store frame-relative coordinates (NOT global)
          // Also detect if we're in an iframe
          const isInIframe = !!window.frameElement;

          if (type === 'click') {
            console.log(`[RECORD] type=${type}, coords=(${x},${y}), isInIframe=${isInIframe}, hasFrameElement=${!!window.frameElement}, target=${target?.tagName}`);
          }

          const action = {
            type,
            x,  // Store frame-relative coordinates
            y,  // Store frame-relative coordinates
            pageX: x + window.scrollX,
            pageY: y + window.scrollY,
            isDrag,
            timestamp: Date.now(),
            isCanvas,
            isInIframe  // Remember which type of frame this came from
          };

          window.__mouseRecorder.actions.push(action);

          // Show visual effect for clicks and mousedown
          if (type === 'click' || type === 'mousedown') {
            showClickEffect(x, y, isCanvas);
          }

          // Log canvas interactions
          if (isCanvas) {
            console.log(`[Canvas ${type}] at (${x}, ${y})`);
          }
        };

        // Define event listeners - use capture phase to catch canvas events
        const listeners = {
          mousedown: (e) => {
            // Only record if the target is in THIS frame (not a child iframe)
            if (e.target.ownerDocument === document) {
              window.__mouseRecorder.isMouseDown = true;
              window.__mouseRecorder.startX = e.clientX;
              window.__mouseRecorder.startY = e.clientY;
              window.__mouseRecorder.scrollX = window.scrollX;
              window.__mouseRecorder.scrollY = window.scrollY;
              recordAction('mousedown', e.clientX, e.clientY, false, e.target);
            }
          },
          mousemove: (e) => {
            if (window.__mouseRecorder.isMouseDown && e.target.ownerDocument === document) {
              recordAction('mousemove', e.clientX, e.clientY, true, e.target);
            }
          },
          mouseup: (e) => {
            if (window.__mouseRecorder.isMouseDown && e.target.ownerDocument === document) {
              const isDrag = Math.abs(e.clientX - window.__mouseRecorder.startX) > 5 ||
                            Math.abs(e.clientY - window.__mouseRecorder.startY) > 5;

              recordAction('mouseup', e.clientX, e.clientY, isDrag, e.target);
              window.__mouseRecorder.isMouseDown = false;
            }
          },
          click: (e) => {
            // Only record if target is in THIS frame and not part of drag
            if (e.target.ownerDocument === document && !window.__mouseRecorder.isMouseDown) {
              recordAction('click', e.clientX, e.clientY, false, e.target);
            }
          }
        };

        // Store listeners for cleanup
        window.__mouseRecorderListeners = listeners;

        // Add event listeners with capture phase to intercept canvas events
        document.addEventListener('mousedown', listeners.mousedown, true);
        document.addEventListener('mousemove', listeners.mousemove, true);
        document.addEventListener('mouseup', listeners.mouseup, true);
        document.addEventListener('click', listeners.click, true);
          });
        } catch (err) {
          console.log(`[WARN] Could not inject into frame: ${err.message}`);
        }
      }

      console.log('[SUCCESS] Recording initialized - canvas interactions will be captured (including iframes)');
    } catch (error) {
      console.log(`\n[ERROR] Failed to start recording: ${error.message}`);
      this.isRecording = false;
    }
  }

  async recordNetworkAction(actionType) {
    if (!this.isRecording) {
      console.log('\n[ERROR] Not recording');
      return;
    }

    try {
      await this.page.evaluate((actionType) => {
        if (window.__mouseRecorder) {
          window.__mouseRecorder.actions.push({
            type: 'networkAction',
            networkActionType: actionType,
            timestamp: Date.now()
          });
        }
      }, actionType);

      if (actionType === 'enablePacketLoss') {
        console.log('[RECORDED] Enable packet loss action added to sequence');
      } else if (actionType === 'disablePacketLoss') {
        console.log('[RECORDED] Disable packet loss action added to sequence');
      }
    } catch (error) {
      console.log(`\n[ERROR] Failed to record network action: ${error.message}`);
    }
  }

  async stopRecording() {
    if (!this.isRecording) {
      console.log('\n[ERROR] No recording in progress');
      return;
    }

    try {
      // Remove visual indicator from main page
      await this.page.evaluate(() => {
        const indicator = document.getElementById('__mouse_recorder_indicator');
        if (indicator) indicator.remove();
      });

      // Remove event listeners from all frames
      const frames = this.page.frames();
      for (const frame of frames) {
        try {
          await frame.evaluate(() => {
            // Remove event listeners
            if (window.__mouseRecorderListeners) {
              const listeners = window.__mouseRecorderListeners;
              document.removeEventListener('mousedown', listeners.mousedown, true);
              document.removeEventListener('mousemove', listeners.mousemove, true);
              document.removeEventListener('mouseup', listeners.mouseup, true);
              document.removeEventListener('click', listeners.click, true);
              delete window.__mouseRecorderListeners;
            }
          });
        } catch (err) {
          // Frame might be inaccessible
        }
      }

      // Collect actions from all frames and tag them with frame info
      let allActions = [];

      for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        const frame = frames[frameIndex];
        try {
          const frameInfo = await frame.evaluate(() => {
            if (!window.__mouseRecorder || !window.__mouseRecorder.actions) {
              return { actions: [], offset: { x: 0, y: 0 } };
            }

            // Get iframe offset if in iframe
            let offset = { x: 0, y: 0 };
            if (window.frameElement) {
              const rect = window.frameElement.getBoundingClientRect();
              offset = { x: rect.left, y: rect.top };
            }

            return { actions: window.__mouseRecorder.actions, offset };
          });

          if (frameInfo.actions && frameInfo.actions.length > 0) {
            // Tag each action with which frame it came from and the offset
            frameInfo.actions.forEach(action => {
              action.frameIndex = frameIndex;
              action.frameOffset = frameInfo.offset;
            });
            allActions = allActions.concat(frameInfo.actions);
          }
        } catch (err) {
          // Frame might be inaccessible, skip it
        }
      }

      // Sort all actions by timestamp to maintain proper order
      this.recordedActions = allActions.sort((a, b) => a.timestamp - b.timestamp);

      this.isRecording = false;

      if (this.recordedActions.length === 0) {
        console.log('\n[RECORDING STOPPED] - No actions captured');
        console.log('[TIP] Make sure you clicked or dragged on the page after pressing "s"');
        return;
      }

      // Count different action types
      const canvasActions = this.recordedActions.filter(a => a.isCanvas).length;
      const networkActions = this.recordedActions.filter(a => a.type === 'networkAction').length;
      const totalActions = this.recordedActions.length;
      const packetLossWasEnabled = this.recordedActions.some(a => a.type === 'networkAction' && a.networkActionType === 'enablePacketLoss');

      console.log(`\n[RECORDING STOPPED] - Captured ${totalActions} actions`);
      if (canvasActions > 0) {
        console.log(`[INFO] ${canvasActions} actions on canvas elements`);
      }
      if (networkActions > 0) {
        console.log(`[INFO] ${networkActions} network actions (packet loss toggles)`);
      }
      if (packetLossWasEnabled) {
        console.log('[INFO] This recording includes sequences with packet loss enabled.');
      }

      const recordingData = {
        metadata: {
          url: this.currentUrl,
          recordedAt: new Date().toISOString(),
          packetLossEnabledInRecording: packetLossWasEnabled,
        },
        actions: this.recordedActions,
      };

      const recordingPath = path.join(this.recordingsDir, `recording_${Date.now()}.json`);
      fs.writeFileSync(recordingPath, JSON.stringify(recordingData, null, 2));
      console.log(`[SAVED] Recording saved to ${recordingPath}`);
    } catch (error) {
      console.log(`\n[ERROR] Failed to stop recording: ${error.message}`);
      console.log('[TIP] The page may have navigated. Press "s" to start recording again.');
      this.isRecording = false;

      // Try to remove indicator even on error
      try {
        await this.page.evaluate(() => {
          const indicator = document.getElementById('__mouse_recorder_indicator');
          if (indicator) indicator.remove();
        });
      } catch {}
    }
  }

  async replay(loopCount = 1) {
    if (this.recordedActions.length === 0) {
      console.log('\n[ERROR] No recorded actions to replay');
      return;
    }

    this.cancelPostReplay = false; // Reset cancellation flag before starting replay

    try {

      for (let currentLoop = 0; currentLoop < loopCount; currentLoop++) {
        if (this.cancelPostReplay) {
          console.log('\n[Loop] cancel iteration loop');
          break;
        }

        // Inject click effect function into all frames for replay visualization
        const replayFrames = this.page.frames();
        for (const frame of replayFrames) {
          try {
            await frame.evaluate(() => {
              if (!window.__showReplayClickEffect) {
                // Add CSS animation if not already present
                if (!document.getElementById('__click_effect_style')) {
                  const style = document.createElement('style');
                  style.id = '__click_effect_style';
                  style.textContent = `
                    @keyframes clickRipple {
                      0% {
                        transform: scale(1);
                        opacity: 1;
                      }
                      100% {
                        transform: scale(3);
                        opacity: 0;
                      }
                    }
                  `;
                  if (document.head) {
                    document.head.appendChild(style);
                  }
                }

                window.__showReplayClickEffect = (x, y, isCanvas = false) => {
                  const effect = document.createElement('div');
                  effect.style.cssText = `
                    position: fixed;
                    left: ${x}px;
                    top: ${y}px;
                    width: 20px;
                    height: 20px;
                    margin-left: -10px;
                    margin-top: -10px;
                    border: 3px solid ${isCanvas ? '#00ff00' : '#0099ff'};
                    border-radius: 50%;
                    pointer-events: none;
                    z-index: 999998;
                    animation: clickRipple 0.6s ease-out;
                  `;
                  if (document.body) {
                    document.body.appendChild(effect);
                    setTimeout(() => effect.remove(), 600);
                  }
                };
              }
            });
          } catch (err) {
            // Frame might be inaccessible
          }
        }

        console.log(`\n[REPLAY STARTED] - Playing ${this.recordedActions.length} actions ${loopCount} time(s)`);
        
        await this.page.evaluate(({ currentLoop, loopCount }) => {
            let indicator = document.getElementById('__replay_indicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = '__replay_indicator';
                indicator.style.cssText = `
                    position: fixed;
                    top: 10px;
                    left: 10px;
                    background: #007bff; /* Blue */
                    color: white;
                    padding: 8px 16px;
                    border-radius: 4px;
                    font-family: monospace;
                    font-size: 14px;
                    font-weight: bold;
                    z-index: 999999;
                    pointer-events: none;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                `;
                document.body.appendChild(indicator);
            }
            const remaining = loopCount - (currentLoop + 1);
            indicator.innerHTML = `REPLAYING (${currentLoop + 1}/${loopCount})<br>${remaining} remaining`;
        }, { currentLoop, loopCount });

        console.log(`[REPLAY] Starting loop ${currentLoop + 1} of ${loopCount}...`);

        for (let i = 0; i < this.recordedActions.length; i++) {
          if (this.cancelPostReplay) {
            console.log('\n[Loop] cancel action loop');
            break;
          }

          const action = this.recordedActions[i];
          const canvasLabel = action.isCanvas ? ' [CANVAS]' : '';

          try {
            if (action.type === 'networkAction') {
              if (action.networkActionType === 'enablePacketLoss') {
                await this.enablePacketLoss();
                console.log(`[${i + 1}/${this.recordedActions.length}] NETWORK: Enabled packet loss`);
              } else if (action.networkActionType === 'disablePacketLoss') {
                await this.disablePacketLoss();
                console.log(`[${i + 1}/${this.recordedActions.length}] NETWORK: Disabled packet loss`);
              }
            } else if (action.type === 'click') {
              // Calculate global coordinates using stored frame offset
              let globalX = action.x;
              let globalY = action.y;

              if (action.frameOffset) {
                globalX = action.x + action.frameOffset.x;
                globalY = action.y + action.frameOffset.y;
              }

              // Show visual effect in the frame where the action was recorded
              const frames = this.page.frames();
              if (action.frameIndex !== undefined && frames[action.frameIndex]) {
                try {
                  await frames[action.frameIndex].evaluate(({ frameX, frameY, isCanvas }) => {
                    if (window.__showReplayClickEffect) {
                      window.__showReplayClickEffect(frameX, frameY, isCanvas);
                    }
                  }, { frameX: action.x, frameY: action.y, isCanvas: action.isCanvas });
                } catch (err) {}
              }

              // Debug: Check what element page.mouse will click
              const elementAtClick = await this.page.evaluate(({ x, y }) => {
                const el = document.elementFromPoint(x, y);
                return el ? { tag: el.tagName, id: el.id, class: el.className } : null;
              }, { x: globalX, y: globalY });

              console.log(`[${i + 1}/${this.recordedActions.length}] Click at frame:(${action.x}, ${action.y}) global:(${globalX}, ${globalY}) isInIframe:${action.isInIframe} element:${elementAtClick?.tag}${canvasLabel}`);

              // Use page.mouse.click with global coordinates - this sends real browser events
              await this.page.mouse.click(globalX, globalY);
            } else if (action.type === 'mousedown') {
              // Calculate global coordinates using stored frame offset
              let globalX = action.x;
              let globalY = action.y;

              if (action.frameOffset) {
                globalX = action.x + action.frameOffset.x;
                globalY = action.y + action.frameOffset.y;
              }

              await this.page.mouse.move(globalX, globalY);
              await this.page.mouse.down();
              console.log(`[${i + 1}/${this.recordedActions.length}] Mouse down at (${action.x}, ${action.y})${canvasLabel}`);
            } else if (action.type === 'mousemove' && action.isDrag) {
              let globalX = action.x;
              let globalY = action.y;

              if (action.frameOffset) {
                globalX = action.x + action.frameOffset.x;
                globalY = action.y + action.frameOffset.y;
              }

              await this.page.mouse.move(globalX, globalY);
              if (i % 10 === 0) {
                console.log(`[${i + 1}/${this.recordedActions.length}] Drag to (${action.x}, ${action.y})${canvasLabel}`);
              }
            } else if (action.type === 'mouseup') {
              let globalX = action.x;
              let globalY = action.y;

              if (action.frameOffset) {
                globalX = action.x + action.frameOffset.x;
                globalY = action.y + action.frameOffset.y;
              }

              await this.page.mouse.move(globalX, globalY);
              await this.page.mouse.up();
              console.log(`[${i + 1}/${this.recordedActions.length}] Mouse up at (${action.x}, ${action.y})${canvasLabel}`);
            }

            if (i < this.recordedActions.length - 1) {
              const nextAction = this.recordedActions[i + 1];
              const delay = nextAction.timestamp - action.timestamp;
              if (delay > 0) {
                await this.page.waitForTimeout(delay);
              }
            }
          } catch (error) {
            console.log(`[ERROR] Failed to replay action ${i + 1}: ${error.message}`);
          }
        }

        if (!this.cancelPostReplay) {
          console.log('[REPLAY COMPLETED]\n');
          await this.postReplaySequence();
        }
      }
    } finally {
      // Ensure the replay indicator is always removed
      if (this.page && !this.page.isClosed()) {
        await this.page.evaluate(() => {
          const indicator = document.getElementById('__replay_indicator');
          if (indicator) indicator.remove();
        });
      }
    }
  }

  async postReplaySequence() {
    try {
      // Reset cancel flag
      this.cancelPostReplay = false;

      // Step 1: Wait for configured time (default 10 seconds) with cancellation checks
      console.log(`[POST-REPLAY] Waiting ${this.postReplayWaitTime / 1000} seconds...`);
      console.log('[TIP] Press "x" to cancel script execution and reload');

      const waitInterval = 500; // Check every 500ms
      const iterations = this.postReplayWaitTime / waitInterval;

      for (let i = 0; i < iterations; i++) {
        if (this.cancelPostReplay) {
          console.log('[POST-REPLAY] Wait cancelled, skipping script and reload\n');
          this.cancelPostReplay = false;
          return;
        }
        await this.page.waitForTimeout(waitInterval);
      }

      // Check one more time before proceeding
      if (this.cancelPostReplay) {
        console.log('[POST-REPLAY] Wait cancelled, skipping script and reload\n');
        this.cancelPostReplay = false;
        return;
      }

      console.log('[POST-REPLAY] Wait complete');

      // Step 2: Run shell script if it exists
      if (fs.existsSync(this.postReplayScript)) {
        console.log(`[POST-REPLAY] Executing script: ${this.postReplayScript}`);

        try {
          const { stdout, stderr } = await execAsync(`bash ${this.postReplayScript}`);

          if (stdout) {
            console.log('[SCRIPT OUTPUT]');
            console.log(stdout.trim());
          }

          if (stderr) {
            console.log('[SCRIPT ERRORS]');
            console.log(stderr.trim());
          }

          console.log('[POST-REPLAY] Script execution complete');
        } catch (error) {
          console.log(`[ERROR] Script execution failed: ${error.message}`);
        }
      } else {
        console.log(`[POST-REPLAY] No script found at ${this.postReplayScript}, skipping`);
      }

      // Step 3: Restore network (disable packet loss)
      console.log('[POST-REPLAY] Restoring network...');
      await this.disablePacketLoss();

      // Step 4: Reload the page
      console.log('[POST-REPLAY] Reloading page...');
      await this.page.reload({ waitUntil: 'networkidle' });
      await this.page.waitForTimeout(8000);
      console.log('[POST-REPLAY] Page reloaded\n');
    } catch (error) {
      console.log(`[ERROR] Post-replay sequence failed: ${error.message}`);
    }
  }

  async enablePacketLoss() {
    try {
      console.log('[NETWORK] Enabling 100% packet loss...');

      const client = await this.page.context().newCDPSession(this.page);

      // Enable Network domain
      await client.send('Network.enable');

      // Set network conditions with 100% packet loss
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: 1,  // unlimited
        uploadThroughput: 1,    // unlimited
        latency: 0,
        packetLoss: 100,         // 100% packet loss
        packetQueueLength: 0,
        packetReordering: false
      });

      await this.page.evaluate(() => {
        const oldIndicator = document.getElementById('__packet_loss_indicator');
        if (oldIndicator) oldIndicator.remove();
        const indicator = document.createElement('div');
        indicator.id = '__packet_loss_indicator';
        indicator.textContent = '⚠️ PACKET LOSS';
        indicator.style.cssText = `
          position: fixed;
          top: 50px;
          right: 10px;
          background: #ffc107;
          color: black;
          padding: 8px 16px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 14px;
          font-weight: bold;
          z-index: 999998;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(indicator);
      });

      console.log('[NETWORK] 100% packet loss enabled - all network requests will fail');
      console.log('[TIP] Press "n" to disable packet loss and restore network');
    } catch (error) {
      console.log(`[ERROR] Failed to enable packet loss: ${error.message}`);
    }
  }

  async disablePacketLoss() {
    try {
      console.log('[NETWORK] Disabling packet loss...');

      const client = await this.page.context().newCDPSession(this.page);

      // Disable network emulation
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
        packetLoss: 0,           // 0% packet loss (normal)
        packetQueueLength: 0,
        packetReordering: false
      });

      await this.page.evaluate(() => {
        const indicator = document.getElementById('__packet_loss_indicator');
        if (indicator) indicator.remove();
      });

      console.log('[NETWORK] Network restored to normal\n');
    } catch (error) {
      console.log(`[ERROR] Failed to disable packet loss: ${error.message}`);
    }
  }

  async cleanup() {
    console.log('\nCleaning up...');
    if (this.context) {
      const sessionPath = this.getSessionPath(this.currentUrl);
      await this.context.storageState({ path: sessionPath });
      console.log('Session saved');
    }
    if (this.browser) {
      await this.browser.close();
    }
    console.log('Browser closed');
  }
}

const recorder = new MouseRecorder();
recorder.start();
