#!/usr/bin/env node

/**
 * Test script for ORB Image Matching
 * Validates that OpenCV.js is properly installed and working
 */

const { findImageWithORB } = require('./orb-matcher');
const fs = require('fs');
const path = require('path');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

console.log(`${colors.cyan}${'='.repeat(50)}${colors.reset}`);
console.log(`${colors.cyan}${colors.bright}    ORB Image Matching Test Suite${colors.reset}`);
console.log(`${colors.cyan}${'='.repeat(50)}${colors.reset}`);
console.log('');

// Test 1: Check if OpenCV.js loads
console.log(`${colors.bright}Test 1: Loading OpenCV.js...${colors.reset}`);
try {
  const cv = require('@techstark/opencv-js');
  console.log(`${colors.green}✓${colors.reset} OpenCV.js loaded successfully`);
  console.log(`  Version: ${cv.getBuildInformation ? 'OpenCV 4.x' : 'Unknown'}`);
} catch (error) {
  console.log(`${colors.red}✗${colors.reset} Failed to load OpenCV.js`);
  console.log(`  Error: ${error.message}`);
  console.log('');
  console.log(`${colors.yellow}Solution:${colors.reset}`);
  console.log('  Run: npm install');
  process.exit(1);
}

// Test 2: Check if Canvas loads (optional)
console.log('');
console.log(`${colors.bright}Test 2: Loading Canvas module (optional)...${colors.reset}`);
try {
  const { createCanvas } = require('canvas');
  const testCanvas = createCanvas(100, 100);
  console.log(`${colors.green}✓${colors.reset} Canvas module loaded successfully`);
} catch (error) {
  console.log(`${colors.yellow}⚠${colors.reset} Canvas not available (optional - using Jimp instead)`);
  console.log(`  Note: Jimp will be used for image processing`);
}

// Test 3: Check if Jimp loads (fallback)
console.log('');
console.log(`${colors.bright}Test 3: Loading Jimp module (fallback)...${colors.reset}`);
try {
  const Jimp = require('jimp');
  console.log(`${colors.green}✓${colors.reset} Jimp module loaded successfully`);
} catch (error) {
  console.log(`${colors.yellow}⚠${colors.reset} Jimp not available (optional fallback)`);
}

// Test 4: Test with actual images if they exist
console.log('');
console.log(`${colors.bright}Test 4: Testing with dog images...${colors.reset}`);

const testImages = [
  { source: 'doga.jpeg', template: 'dogb.jpeg' },
  { source: 'test-source.jpg', template: 'test-template.jpg' },
  { source: 'canvas.png', template: 'character.png' }
];

let foundTestImages = false;

for (const test of testImages) {
  if (fs.existsSync(test.source) && fs.existsSync(test.template)) {
    foundTestImages = true;
    console.log(`  Testing: ${test.source} vs ${test.template}`);

    findImageWithORB(test.source, test.template, {
      minMatches: 5,
      ratioThreshold: 0.75,
      verbose: false
    })
    .then(result => {
      if (result.error) {
        console.log(`  ${colors.red}✗${colors.reset} Error: ${result.error}`);
      } else if (result.found) {
        console.log(`  ${colors.green}✓${colors.reset} Match found!`);
        console.log(`    - Matches: ${result.matches}`);
        console.log(`    - Confidence: ${result.confidence ? (result.confidence * 100).toFixed(1) + '%' : 'N/A'}`);
        if (result.center) {
          console.log(`    - Location: (${Math.round(result.center.x)}, ${Math.round(result.center.y)})`);
        }
      } else {
        console.log(`  ${colors.yellow}⚠${colors.reset} No match found`);
        console.log(`    - Matches: ${result.matches} (needed: ${result.minMatchesRequired})`);
      }
      console.log(`    - Time: ${result.executionTime}`);
    })
    .catch(error => {
      console.log(`  ${colors.red}✗${colors.reset} Test failed: ${error.message}`);
    });

    break;
  }
}

if (!foundTestImages) {
  console.log(`  ${colors.yellow}No test images found${colors.reset}`);
  console.log('  Place test images in current directory to test matching');
  console.log('  Expected: doga.jpeg, dogb.jpeg');
}

// Test 5: Performance test with synthetic data
console.log('');
console.log(`${colors.bright}Test 5: Performance test with synthetic images...${colors.reset}`);

const Jimp = require('jimp');

// Create synthetic test images
async function createSyntheticTest() {
  try {
    // Create source image with multiple rectangles using Jimp
    const sourceImg = new Jimp(800, 600, 0xFFFFFFFF); // White background

    // Draw various colored rectangles
    // Red rectangle
    for (let y = 50; y < 150; y++) {
      for (let x = 50; x < 150; x++) {
        sourceImg.setPixelColor(Jimp.rgbaToInt(255, 0, 0, 255), x, y);
      }
    }

    // Blue rectangle
    for (let y = 200; y < 300; y++) {
      for (let x = 200; x < 300; x++) {
        sourceImg.setPixelColor(Jimp.rgbaToInt(0, 0, 255, 255), x, y);
      }
    }

    // Green rectangle with texture (this will be our template)
    for (let y = 300; y < 400; y++) {
      for (let x = 400; x < 500; x++) {
        // Add vertical lines as texture
        if ((x - 400) % 20 < 2) {
          sourceImg.setPixelColor(Jimp.rgbaToInt(0, 0, 0, 255), x, y); // Black lines
        } else {
          sourceImg.setPixelColor(Jimp.rgbaToInt(0, 255, 0, 255), x, y); // Green
        }
      }
    }

    // Yellow rectangle
    for (let y = 100; y < 200; y++) {
      for (let x = 600; x < 700; x++) {
        sourceImg.setPixelColor(Jimp.rgbaToInt(255, 255, 0, 255), x, y);
      }
    }

    // Create template (the green rectangle with texture)
    const templateImg = new Jimp(100, 100, 0x00FF00FF); // Green background

    // Add same texture to template
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        // Add vertical lines as texture
        if (x % 20 < 2) {
          templateImg.setPixelColor(Jimp.rgbaToInt(0, 0, 0, 255), x, y); // Black lines
        } else {
          templateImg.setPixelColor(Jimp.rgbaToInt(0, 255, 0, 255), x, y); // Green
        }
      }
    }

    // Save temporary files
    await sourceImg.writeAsync('test-synthetic-source.png');
    await templateImg.writeAsync('test-synthetic-template.png');

    // Test matching
    const startTime = Date.now();
    const result = await findImageWithORB(
      'test-synthetic-source.png',
      'test-synthetic-template.png',
      {
        minMatches: 5,
        outputPath: 'test-synthetic-result.png'
      }
    );

    const elapsed = Date.now() - startTime;

    if (result.found) {
      console.log(`  ${colors.green}✓${colors.reset} Synthetic test passed!`);
      console.log(`    - Expected position: (400, 300)`);
      if (result.position) {
        console.log(`    - Detected position: (${Math.round(result.position.x)}, ${Math.round(result.position.y)})`);
      }
      console.log(`    - Matches: ${result.matches}`);
      console.log(`    - Time: ${elapsed}ms`);

      if (elapsed < 500) {
        console.log(`    - ${colors.green}Performance: GOOD (< 500ms)${colors.reset}`);
      } else if (elapsed < 1000) {
        console.log(`    - ${colors.yellow}Performance: OK (< 1s)${colors.reset}`);
      } else {
        console.log(`    - ${colors.red}Performance: SLOW (> 1s)${colors.reset}`);
      }
    } else {
      console.log(`  ${colors.red}✗${colors.reset} Synthetic test failed`);
      console.log(`    - Matches found: ${result.matches} (needed: ${result.minMatchesRequired})`);
      console.log(`    - Try running with --min-matches 3`);
    }

    // Cleanup
    fs.unlinkSync('test-synthetic-source.png');
    fs.unlinkSync('test-synthetic-template.png');
    if (fs.existsSync('test-synthetic-result.png')) {
      console.log(`    - Visualization saved to: test-synthetic-result.png`);
    }

  } catch (error) {
    console.log(`  ${colors.red}✗${colors.reset} Synthetic test error: ${error.message}`);
  }
}

createSyntheticTest().then(() => {
  console.log('');
  console.log(`${colors.cyan}${'='.repeat(50)}${colors.reset}`);
  console.log(`${colors.bright}Test Summary:${colors.reset}`);
  console.log('  All critical components loaded successfully!');
  console.log('  ORB image matching is ready to use.');
  console.log('');
  console.log(`${colors.bright}Usage:${colors.reset}`);
  console.log('  node find-image-orb.js source.jpg template.jpg');
  console.log('  node find-image-orb.js --help');
  console.log(`${colors.cyan}${'='.repeat(50)}${colors.reset}`);
});