const { chromium } = require('playwright');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

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

    // Load config from file or use defaults
    this.loadConfig();

    this.cancelPostReplay = false;  // Flag to cancel post-replay sequence
    this.receivedNop = false;  // Flag for NOP request detection
    this.skipNopWait = false;  // Flag to skip NOP wait
    this.inputMode = 'normal';
    this.inputBuffer = '';
    this.isCapturing = false;  // Flag for network tracking capture state
    this.draw = 0;
    this.targetDraw = 1;
    this.pendingReplayLoops = 0;  // Store replay count while waiting for draw count
    this.capturedUrls = [];  // Store matching URLs for overlay display
  }

  loadConfig() {
    // Allow config file path to be specified via command-line argument
    // Usage: node index.js [config-file-path]
    const configPath = process.argv[2] || './config.json';
    let config = {};

    // Try to load config file
    if (fs.existsSync(configPath)) {
      try {
        const configData = fs.readFileSync(configPath, 'utf8');
        config = JSON.parse(configData);
        console.log(`[CONFIG] Loaded configuration from ${configPath}`);
      } catch (error) {
        console.log(`[CONFIG] Error reading ${configPath}, using defaults: ${error.message}`);
      }
    } else {
      console.log(`[CONFIG] Config file not found at ${configPath}, using defaults`);
    }

    // Set values with fallback to platform-specific defaults
    const defaultScript = process.platform === 'win32' ? './post-replay.bat' : './post-replay.sh';
    this.postReplayScript = config.postReplayScript || defaultScript;
    this.postReplayWaitTime = config.postReplayWaitTime || 6000;  // Default: 6 seconds
    this.postReloadWaitTime = config.postReloadWaitTime || 8000;  // Default: 8 seconds

    // Network tracking patterns (can be single string or array of strings)
    this.networkTrackingStartPatterns = config.networkTrackingStartPatterns || [];
    this.networkTrackingFilterPatterns = config.networkTrackingFilterPatterns || [];
    this.networkTrackingSuffix = config.networkTrackingSuffix || '_big';

    // Convert to array if single string provided
    if (typeof this.networkTrackingStartPatterns === 'string') {
      this.networkTrackingStartPatterns = [this.networkTrackingStartPatterns];
    }
    if (typeof this.networkTrackingFilterPatterns === 'string') {
      this.networkTrackingFilterPatterns = [this.networkTrackingFilterPatterns];
    }
  }

  async hotReloadConfig() {
    console.log('\n[HOT RELOAD] Reloading configuration...');
    const configPath = process.argv[2] || './config.json';

    // Store old values for comparison
    const oldPostReplayWaitTime = this.postReplayWaitTime;
    const oldPostReloadWaitTime = this.postReloadWaitTime;
    const oldTargetDraw = this.targetDraw;

    // Reload config
    this.loadConfig();

    // Show what changed
    console.log('\n[CONFIG] Current settings:');
    console.log(`  Post-replay wait time: ${this.postReplayWaitTime}ms ${oldPostReplayWaitTime !== this.postReplayWaitTime ? '(CHANGED)' : ''}`);
    console.log(`  Post-reload wait time: ${this.postReloadWaitTime}ms ${oldPostReloadWaitTime !== this.postReloadWaitTime ? '(CHANGED)' : ''}`);
    console.log(`  Network tracking start patterns: ${JSON.stringify(this.networkTrackingStartPatterns)}`);
    console.log(`  Network tracking suffix: "${this.networkTrackingSuffix}"`);
    console.log(`  Network tracking filter patterns: ${JSON.stringify(this.networkTrackingFilterPatterns)}`);
    console.log(`\n[HOT RELOAD] Configuration reloaded successfully\n`);

    // Update overlay with new config
    await this.updateFilterOverlay();
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
    console.log('Press "c" - Skip NOP wait during replay');
    console.log('Press "x" - Cancel replay loop / post-replay sequence');
    console.log('Press "h" - Hot reload configuration file');
    console.log('Press "q" - Quit\n');
    console.log('TIP: Press "p" during recording to insert packet loss into the sequence!');

    this.setupKeyboardListener();
  }

  async initBrowser(url) {
    console.log('\nInitializing browser...');

    const args = [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled'
    ];

    // Add incognito mode if environment variable is set
    if (process.env.INCOGNITO === 'true' || process.env.INCOGNITO === '1') {
      // Note: Playwright browser contexts are already isolated (like incognito)
      // These flags try to force visual incognito mode appearance
      args.push('--incognito');
      console.log('[INCOGNITO] Incognito mode requested');
      console.log('[INFO] Note: Playwright contexts are already isolated like incognito mode');
      console.log('[INFO] Visual appearance may not show incognito theme');
    }

    const launchOptions = {
      headless: false,
      slowMo: 50,
      args
    };

    // Use Chrome from environment variable if provided
    if (process.env.CHROME_PATH) {
      launchOptions.executablePath = process.env.CHROME_PATH;
      console.log(`Using Chrome from CHROME_PATH: ${process.env.CHROME_PATH}`);
    }

    this.browser = await chromium.launch(launchOptions);

    const sessionPath = this.getSessionPath(url);

    // Context options for maximized window
    const contextOptions = {
      viewport: null, // Disable default viewport to use full window size
    };

    // Load session if it exists (works even in incognito mode)
    if (fs.existsSync(sessionPath)) {
      console.log('Loading existing session...');
      contextOptions.storageState = sessionPath;
    } else {
      console.log('Creating new session...');
    }

    this.context = await this.browser.newContext(contextOptions);

    this.page = await this.context.newPage();

    // Add network request logging (if configured)
    if (this.networkTrackingStartPatterns.length > 0) {
      let capturedRequests = [];

      const matchesAnyPattern = (url, patterns) => {
        return patterns.some(pattern => url.includes(pattern));
      };

       this.page.on('request', async request => {
         const url = request.url();

         // Check if this is a NOP request
         if (url.includes('nop')) {
           this.receivedNop = true;
           console.log(`[NOP RECEIVED] Detected NOP request: ${url}`);
         }

          // Check if this is a START request
         if (!this.isCapturing && matchesAnyPattern(url, this.networkTrackingStartPatterns)) {
           this.isCapturing = true;
           capturedRequests = [];
           console.log(`\n[CAPTURE START] Detected start pattern: ${url}`);
           console.log(`[TRACKING] Now logging requests ending with "${this.networkTrackingSuffix}"...\n`);
         }

        // If capturing, only process requests ending with the configured suffix
        if (this.isCapturing) {
          // Check if URL ends with the configured suffix (before query string)
          const urlPath = url.split('?')[0]; // Remove query string
          if (urlPath.endsWith(this.networkTrackingSuffix)) {
            console.log(`[REQUEST] ${request.method()} ${url}`);
            capturedRequests.push({ type: 'request', method: request.method(), url });

            // Cancel post-replay sequence if this request matches filter patterns
            if (this.networkTrackingFilterPatterns.length > 0 && matchesAnyPattern(url, this.networkTrackingFilterPatterns)) {
              this.draw += 1;

              // Extract last part of URL after the last '/'
              const urlParts = url.split('/');
              let lastPart = urlParts[urlParts.length - 1];

              // Remove networkTrackingSuffix if present
              if (lastPart.endsWith(this.networkTrackingSuffix)) {
                lastPart = lastPart.slice(0, -this.networkTrackingSuffix.length);
              }

              this.capturedUrls.push(lastPart);

              console.log(`[DRAW DETECTED] Draw ${this.draw} of ${this.targetDraw} detected: ${url}`);
              console.log(`[URL CAPTURED] ${lastPart}`);

              // Update the URL overlay
              await this.updateUrlOverlay();

              if (this.draw === this.targetDraw) {
                this.cancelPostReplay = true;
                console.log(`[CANCEL] Target draw count reached (${this.targetDraw}). Post-replay sequence cancelled.`);
              }
              await this.disablePacketLoss();
            }
          }
        }
      });

      console.log('[NETWORK TRACKING] Enabled with patterns:');
      console.log(`  Start: ${JSON.stringify(this.networkTrackingStartPatterns)}`);
      console.log(`  Suffix: "${this.networkTrackingSuffix}"`);
      if (this.networkTrackingFilterPatterns.length > 0) {
        console.log(`  Filter (for suffix requests): ${JSON.stringify(this.networkTrackingFilterPatterns)}`);
      }
    }

    console.log(`Navigating to ${url}...`);
    await this.page.goto(url);

    console.log('Browser ready!\n');
  }

  async initFilterOverlay() {
    await this.page.evaluate(() => {
      const overlay = document.getElementById('__filter_overlay');
      if (overlay) overlay.remove();

      const filterOverlay = document.createElement('div');
      filterOverlay.id = '__filter_overlay';
      filterOverlay.style.cssText = `
        position: fixed;
        left: 10px;
        bottom: 10px;
        background: rgba(255, 255, 255, 0.95);
        color: black;
        padding: 12px 16px;
        border-radius: 6px;
        font-family: 'Courier New', monospace;
        font-size: 14px;
        font-weight: normal;
        z-index: 999999;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        max-width: 300px;
        line-height: 1.8;
      `;
      document.body.appendChild(filterOverlay);
    });
    await this.updateFilterOverlay();
  }

  async updateFilterOverlay() {
    const filterPatterns = this.networkTrackingFilterPatterns.length > 0 ? this.networkTrackingFilterPatterns : ['None'];

    await this.page.evaluate(({ filterPatterns }) => {
      const overlay = document.getElementById('__filter_overlay');
      if (!overlay) return;

      let patternsHtml = '';
      if (Array.isArray(filterPatterns)) {
        patternsHtml = filterPatterns.map(p => `<div style="color: #333;">${p}</div>`).join('');
      } else {
        patternsHtml = `<div style="color: #333;">${filterPatterns}</div>`;
      }

      overlay.innerHTML = `
        <div style="margin-bottom: 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px;"><strong>Filter Patterns:</strong></div>
        ${patternsHtml}
      `;
    }, { filterPatterns });
  }

  async initUrlOverlay() {
    await this.page.evaluate(() => {
      const overlay = document.getElementById('__url_overlay');
      if (overlay) overlay.remove();

      const urlOverlay = document.createElement('div');
      urlOverlay.id = '__url_overlay';
      urlOverlay.style.cssText = `
        position: fixed;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        background: rgba(255, 255, 255, 0.95);
        color: black;
        padding: 12px 16px;
        border-radius: 6px;
        font-family: 'Courier New', monospace;
        font-size: 14px;
        font-weight: normal;
        z-index: 999999;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        max-width: 300px;
        max-height: 300px;
        overflow-y: auto;
        line-height: 1.8;
      `;
      document.body.appendChild(urlOverlay);
    });
    await this.updateUrlOverlay();
  }

  async updateUrlOverlay() {
    const capturedUrls = this.capturedUrls.length > 0 ? this.capturedUrls : [];

    await this.page.evaluate(({ capturedUrls }) => {
      const overlay = document.getElementById('__url_overlay');
      if (!overlay) return;

      let urlsHtml = '';
      if (capturedUrls.length === 0) {
        urlsHtml = '<div style="color: #999; font-style: italic;">No draw</div>';
      } else {
        urlsHtml = capturedUrls.map((url, index) =>
          `<div style="color: #333; margin: 4px 0;">${index + 1}. ${url}</div>`
        ).join('');
      }

      overlay.innerHTML = `
        <div style="margin-bottom: 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px;"><strong>Draw:</strong></div>
        ${urlsHtml}
      `;
    }, { capturedUrls });
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
            this.pendingReplayLoops = loopCount;
            this.inputMode = 'settingTargetDraw';
            this.inputBuffer = '';
            process.stdout.write('\n');
            process.stdout.write('How many draws to wait for before canceling? (default: 1): ');
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
      } else if (this.inputMode === 'settingTargetDraw') {
        if (key.name === 'return' || key.name === 'enter') {
            let drawCount = parseInt(this.inputBuffer, 10);
            if (isNaN(drawCount) || drawCount <= 0) {
                drawCount = 1;
            }
            this.targetDraw = drawCount;
            this.inputMode = 'normal';
            this.inputBuffer = '';
            process.stdout.write('\n');
            await this.replay(this.pendingReplayLoops);
        } else if (key.name === 'c' || key.name === 'escape') {
            this.inputMode = 'normal';
            this.inputBuffer = '';
            this.pendingReplayLoops = 0;
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
          await this.disablePacketLoss();
        } else if (key.name === 'c') {
          this.skipNopWait = true;
          console.log('\n[SKIP] NOP wait skipped by user');
        } else if (key.name === 'x') {
          this.cancelPostReplay = true;
          console.log('\n[CANCELLED] Replay loop/sequence cancelled by user');
        } else if (key.name === 'h') {
          await this.hotReloadConfig();
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
              document.removeEventListener('mouseup', listeners.mouseup, true);
              document.removeEventListener('click', listeners.click, true);
              delete window.__mouseRecorderListeners;
            }
          });
        } catch (err) {
          // Frame might be inaccessible
        }
      }

      // First, get iframe offsets from the main page (works for cross-origin iframes)
      const iframeOffsets = await this.page.evaluate(() => {
        const offsets = [{ x: 0, y: 0 }]; // Main frame has no offset
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(iframe => {
          const rect = iframe.getBoundingClientRect();
          offsets.push({ x: rect.left, y: rect.top });
        });
        return offsets;
      });

      // Collect actions from all frames and tag them with frame info
      let allActions = [];

      for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        const frame = frames[frameIndex];
        try {
          const frameActions = await frame.evaluate(() => {
            if (!window.__mouseRecorder || !window.__mouseRecorder.actions) {
              return [];
            }
            return window.__mouseRecorder.actions;
          });

          if (frameActions && frameActions.length > 0) {
            // Tag each action with which frame it came from and the offset
            frameActions.forEach(action => {
              action.frameIndex = frameIndex;
              action.frameOffset = iframeOffsets[frameIndex] || { x: 0, y: 0 };
            });
            allActions = allActions.concat(frameActions);
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
    this.draw = 0;
    this.capturedUrls = [];

    try {

      for (let currentLoop = 0; currentLoop < loopCount; currentLoop++) {
        if (this.cancelPostReplay) {
          console.log('\n[Loop] cancel iteration loop');
          break;
        }

        // Re-initialize the filter overlay at the start of each loop
        await this.initFilterOverlay();

        // Re-initialize the URL overlay at the start of each loop
        await this.initUrlOverlay();

        // Reset network capturing state at the start of each replay iteration
        this.isCapturing = false;


        console.log('[REPLAY] Waiting for NOP request after reload...');
        console.log('[TIP] Press "c" to skip waiting for NOP');
        let waited = 0;
        const maxWait = 30000; // 60 second timeout
        this.skipNopWait = false; // Reset skip flag
        while (!this.receivedNop && !this.skipNopWait && waited < maxWait) {
          await this.page.waitForTimeout(500);
          waited += 500;
        }
        if (this.skipNopWait) {
          console.log('[REPLAY] NOP wait skipped by user, proceeding...');
        } else if (this.receivedNop) {
          console.log('[REPLAY] NOP request received, proceeding...');
        } else {
          console.log('[REPLAY] Timeout waiting for NOP request, proceeding anyway...');
        }

        await this.page.waitForTimeout(2000);
        this.receivedNop = false;
        this.skipNopWait = false; // Reset skip flag

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

        console.log(`\n[REPLAY STARTED] - Playing ${this.recordedActions.length} actions ${currentLoop} / ${loopCount} time(s)`);
        console.log(`[REPLAY CONFIG] - Target draw count: ${this.draw} / ${this.targetDraw} times(s)`);

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

        // Track last mousedown position for drag interpolation
        let lastMouseDownX = 0;
        let lastMouseDownY = 0;

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

              // Use page.mouse.click with global coordinates - this sends real browser events
              await this.page.mouse.click(globalX, globalY);
              console.log(`[${i + 1}/${this.recordedActions.length}] Click at (${action.x}, ${action.y})${canvasLabel}`);
            } else if (action.type === 'mousedown') {
              // Calculate global coordinates using stored frame offset
              let globalX = action.x;
              let globalY = action.y;

              if (action.frameOffset) {
                globalX = action.x + action.frameOffset.x;
                globalY = action.y + action.frameOffset.y;
              }

              // Save position for drag interpolation
              lastMouseDownX = globalX;
              lastMouseDownY = globalY;

              await this.page.mouse.move(globalX, globalY);
              await this.page.mouse.down();
              console.log(`[${i + 1}/${this.recordedActions.length}] Mouse down at (${action.x}, ${action.y})${canvasLabel}`);
            } else if (action.type === 'mousemove' && action.isDrag) {
              // Skip mousemove events for instant drag behavior
              // Maintains backward compatibility with old recordings
              continue;
            } else if (action.type === 'mouseup') {
              let globalX = action.x;
              let globalY = action.y;

              if (action.frameOffset) {
                globalX = action.x + action.frameOffset.x;
                globalY = action.y + action.frameOffset.y;
              }

              // If this is a drag, interpolate between mousedown and mouseup positions
              // This generates intermediate mousemove events so canvas apps can draw the path
              if (action.isDrag) {
                const steps = 15; // Number of intermediate points
                const deltaX = (globalX - lastMouseDownX) / steps;
                const deltaY = (globalY - lastMouseDownY) / steps;

                for (let step = 1; step <= steps; step++) {
                  const interpolatedX = lastMouseDownX + (deltaX * step);
                  const interpolatedY = lastMouseDownY + (deltaY * step);
                  await this.page.mouse.move(interpolatedX, interpolatedY);
                  // Small delay to allow canvas to process each move
                  await this.page.waitForTimeout(5);
                }
              }

              // Always move to exact final position (ensures accuracy even after interpolation)
              await this.page.mouse.move(globalX, globalY);

              await this.page.mouse.up();
              const dragLabel = action.isDrag ? ' [DRAG]' : '';
              console.log(`[${i + 1}/${this.recordedActions.length}] Mouse up at (${action.x}, ${action.y})${canvasLabel}${dragLabel}`);
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

      // Step 1: Wait for configured time (default 10 seconds) with cancellation checks
      console.log(`[POST-REPLAY] Waiting ${this.postReplayWaitTime / 1000} seconds...`);
      console.log('[TIP] Press "x" to cancel script execution and reload');

      const waitInterval = 500; // Check every 500ms
      const iterations = this.postReplayWaitTime / waitInterval;

      for (let i = 0; i < iterations; i++) {
        if (this.cancelPostReplay) {
          console.log('[POST-REPLAY] Wait cancelled, skipping script and reload\n');
          return;
        }
        await this.page.waitForTimeout(waitInterval);
      }

      // Check one more time before proceeding
      if (this.cancelPostReplay) {
        console.log('[POST-REPLAY] Wait cancelled, skipping script and reload\n');
        return;
      }

      console.log('[POST-REPLAY] Wait complete');

      // // Step 2: Run shell script if it exists
      // if (fs.existsSync(this.postReplayScript)) {
      //   // Convert to absolute path (Windows doesn't like './')
      //   const absoluteScriptPath = path.resolve(this.postReplayScript);
      //   console.log(`[POST-REPLAY] Executing script: ${absoluteScriptPath}`);
      //
      //   try {
      //     // Determine the appropriate shell command based on platform
      //     let command;
      //     if (process.platform === 'win32') {
      //       // Windows: use cmd.exe to execute .bat or .cmd files
      //       // Quote the path in case it contains spaces
      //       command = `cmd /c "${absoluteScriptPath}"`;
      //     } else {
      //       // Unix/Linux/macOS: use bash for .sh files
      //       command = `bash "${absoluteScriptPath}"`;
      //     }
      //
      //     const { stdout, stderr } = await execAsync(command);
      //
      //     if (stdout) {
      //       console.log('[SCRIPT OUTPUT]');
      //       // Handle both string and buffer
      //       const output = typeof stdout === 'string' ? stdout : stdout.toString();
      //       console.log(output.trim());
      //     }
      //
      //     if (stderr) {
      //       console.log('[SCRIPT ERRORS]');
      //       // Handle both string and buffer
      //       const errors = typeof stderr === 'string' ? stderr : stderr.toString();
      //       console.log(errors.trim());
      //     }
      //
      //     console.log('[POST-REPLAY] Script execution complete');
      //   } catch (error) {
      //     console.log(`[ERROR] Script execution failed: ${error.message}`);
      //   }
      // } else {
      //   console.log(`[POST-REPLAY] No script found at ${this.postReplayScript}, skipping`);
      // }
      //
      // // Step 3: Restore network (disable packet loss)
      // console.log('[POST-REPLAY] Restoring network...');
      // await this.disablePacketLoss();
      //
      // // Step 4: Reload the page
      console.log('[POST-REPLAY] Reloading page...');

      // Wait a bit for network to stabilize after WiFi toggle
      // await this.page.waitForTimeout(2000);

      // Try to reload with error handling
      try {
        // Start reload with packet loss enabled (don't await - we'll cancel it)
        const reloadPromise = this.page.reload({
          waitUntil: 'domcontentloaded',
          timeout: 30000
        }).catch(err => {
          // Expected error - reload will be aborted when we navigate to about:blank
          console.log(`[POST-REPLAY] Reload aborted as expected: ${err.message}`);
        });

        console.log('[POST-REPLAY] wait for 1 seconds...');
        await this.page.waitForTimeout(1000);

        // Navigate to about:blank to cancel all pending requests
        console.log('[POST-REPLAY] Cancelling pending requests...');
        await this.page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 });

        // Now it's safe to restore network - all requests are cancelled
        await this.disablePacketLoss();

        // Navigate back to the original URL
        console.log('[POST-REPLAY] Reloading with restored network...');
        await this.page.goto(this.currentUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

      } catch (error) {
        console.log(`[ERROR] Reload failed: ${error.message}`);
        console.log('[INFO] You may need to manually refresh the page');
      }

      await this.page.waitForTimeout(this.postReloadWaitTime);
      console.log('[POST-REPLAY] Page reloaded\n');
    } catch (error) {
      console.log(`[ERROR] Post-replay sequence failed: ${error.message}`);
    }
  }

  async enablePacketLoss() {
    try {
      console.log('[NETWORK] Enabling 100% packet loss...');

      // Apply network emulation to main page
      const mainClient = await this.page.context().newCDPSession(this.page);
      await mainClient.send('Network.enable');
      await mainClient.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: 1,
        uploadThroughput: 1,
        latency: 0,
        packetLoss: 100,
        packetQueueLength: 0,
        packetReordering: false
      });

      // Apply network emulation to all iframes
      const frames = this.page.frames();
      for (const frame of frames) {
        if (frame !== this.page.mainFrame()) {
          try {
            const frameClient = await this.page.context().newCDPSession(frame);
            await frameClient.send('Network.enable');
            await frameClient.send('Network.emulateNetworkConditions', {
              offline: false,
              downloadThroughput: 1,
              uploadThroughput: 1,
              latency: 0,
              packetLoss: 100,
              packetQueueLength: 0,
              packetReordering: false
            });
          } catch (err) {
            // Frame might not support CDP (cross-origin), skip it
          }
        }
      }

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

      console.log('[NETWORK] 100% packet loss enabled - all network requests will be throttled');
      console.log('[TIP] Press "n" to disable packet loss and restore network');
    } catch (error) {
      console.log(`[ERROR] Failed to enable packet loss: ${error.message}`);
    }
  }

  async disablePacketLoss() {
    try {
      console.log('[NETWORK] Disabling packet loss...');

      // Restore network for main page
      const mainClient = await this.page.context().newCDPSession(this.page);
      await mainClient.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
        packetLoss: 0,
        packetQueueLength: 0,
        packetReordering: false
      });

      // Restore network for all iframes
      const frames = this.page.frames();
      for (const frame of frames) {
        if (frame !== this.page.mainFrame()) {
          try {
            const frameClient = await this.page.context().newCDPSession(frame);
            await frameClient.send('Network.emulateNetworkConditions', {
              offline: false,
              downloadThroughput: -1,
              uploadThroughput: -1,
              latency: 0,
              packetLoss: 0,
              packetQueueLength: 0,
              packetReordering: false
            });
          } catch (err) {
            // Frame might not support CDP, skip it
          }
        }
      }

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
      // Save session (even in incognito mode, so it can be reused)
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
recorder.start().catch(error => {
  console.error('\n[FATAL ERROR]', error.message);
  console.error('\nStack trace:', error.stack);
  console.error('\nPress any key to exit...');

  // Keep window open on error
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', () => process.exit(1));
});
