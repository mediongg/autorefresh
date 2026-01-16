#!/usr/bin/env node

/**
 * CLI Wrapper for ORB Image Matching
 * User-friendly command-line interface for finding images using ORB features
 */

const { findImageWithORB } = require('./orb-matcher');
const fs = require('fs');
const path = require('path');

// ANSI color codes for pretty output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function printHeader() {
  console.log(`${colors.cyan}${'='.repeat(50)}${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}    ORB Feature-Based Image Matching${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(50)}${colors.reset}`);
  console.log('');
}

function printHelp() {
  console.log(`${colors.bright}Usage:${colors.reset}`);
  console.log('  node find-image-orb.js <source-image> <template-image> [options]');
  console.log('');
  console.log(`${colors.bright}Description:${colors.reset}`);
  console.log('  Finds template image within source image using ORB feature matching.');
  console.log('  Works with different scales, rotations, and lighting conditions.');
  console.log('');
  console.log(`${colors.bright}Options:${colors.reset}`);
  console.log('  --min-matches <num>     Minimum feature matches required (default: 10)');
  console.log('  --ratio <0-1>           Lowe\'s ratio test threshold (default: 0.75)');
  console.log('  --output <path>         Save visualization with bounding box');
  console.log('  --verbose               Show detailed matching progress');
  console.log('  --json                  Output raw JSON instead of formatted text');
  console.log('  --help                  Show this help message');
  console.log('');
  console.log(`${colors.bright}Examples:${colors.reset}`);
  console.log('  # Basic matching');
  console.log('  node find-image-orb.js screenshot.png character.png');
  console.log('');
  console.log('  # With visualization');
  console.log('  node find-image-orb.js canvas.jpg template.jpg --output result.png');
  console.log('');
  console.log('  # More lenient matching');
  console.log('  node find-image-orb.js source.png target.png --min-matches 5 --ratio 0.8');
  console.log('');
  console.log(`${colors.bright}Exit Codes:${colors.reset}`);
  console.log('  0 - Template found in source');
  console.log('  1 - Template not found');
  console.log('  2 - Error occurred');
  console.log('');
  console.log(`${colors.gray}Powered by OpenCV.js and ORB (Oriented FAST and Rotated BRIEF)${colors.reset}`);
}

function formatResult(result, jsonOutput) {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('');
  console.log(`${colors.bright}=== MATCHING RESULTS ===${colors.reset}`);
  console.log('');

  if (result.error) {
    console.log(`${colors.red}✗ ERROR:${colors.reset} ${result.error}`);
    return;
  }

  if (result.found) {
    console.log(`${colors.green}${colors.bright}✓ TEMPLATE FOUND IN SOURCE IMAGE${colors.reset}`);
    console.log('');

    // Match statistics
    console.log(`${colors.bright}Match Statistics:${colors.reset}`);
    console.log(`  Feature matches:     ${colors.green}${result.matches}${colors.reset} (required: ${result.minMatchesRequired})`);

    if (result.inlierMatches !== undefined) {
      const inlierRatio = ((result.inlierMatches / result.matches) * 100).toFixed(1);
      console.log(`  Inlier matches:      ${result.inlierMatches} (${inlierRatio}%)`);
    }

    if (result.confidence !== undefined) {
      const confPercent = (result.confidence * 100).toFixed(1);
      const confColor = result.confidence > 0.8 ? colors.green :
                       result.confidence > 0.6 ? colors.yellow : colors.red;
      console.log(`  Confidence:          ${confColor}${confPercent}%${colors.reset}`);
    }

    console.log(`  Template keypoints:  ${result.templateFeatures}`);
    console.log(`  Source keypoints:    ${result.sourceFeatures}`);
    console.log('');

    // Location information
    if (result.position || result.center) {
      console.log(`${colors.bright}Location:${colors.reset}`);
      if (result.position) {
        console.log(`  Top-left position:   (${Math.round(result.position.x)}, ${Math.round(result.position.y)})`);
      }
      if (result.center) {
        console.log(`  Center position:     (${Math.round(result.center.x)}, ${Math.round(result.center.y)})`);
      }
      console.log('');
    }

    // Bounding box corners
    if (result.boundingBox) {
      console.log(`${colors.bright}Bounding Box Corners:${colors.reset}`);
      console.log(`  Top-left:     (${Math.round(result.boundingBox.topLeft.x)}, ${Math.round(result.boundingBox.topLeft.y)})`);
      console.log(`  Top-right:    (${Math.round(result.boundingBox.topRight.x)}, ${Math.round(result.boundingBox.topRight.y)})`);
      console.log(`  Bottom-right: (${Math.round(result.boundingBox.bottomRight.x)}, ${Math.round(result.boundingBox.bottomRight.y)})`);
      console.log(`  Bottom-left:  (${Math.round(result.boundingBox.bottomLeft.x)}, ${Math.round(result.boundingBox.bottomLeft.y)})`);
      console.log('');
    }

    if (result.visualizationSaved) {
      console.log(`${colors.bright}Visualization:${colors.reset}`);
      console.log(`  Saved to: ${colors.cyan}${result.visualizationSaved}${colors.reset}`);
      console.log('');
    }

  } else {
    console.log(`${colors.red}${colors.bright}✗ TEMPLATE NOT FOUND IN SOURCE IMAGE${colors.reset}`);
    console.log('');

    if (result.reason) {
      console.log(`${colors.bright}Reason:${colors.reset} ${result.reason}`);
    } else {
      console.log(`${colors.bright}Match Statistics:${colors.reset}`);
      console.log(`  Feature matches:     ${colors.red}${result.matches}${colors.reset} (required: ${result.minMatchesRequired})`);
      console.log(`  Template keypoints:  ${result.templateFeatures}`);
      console.log(`  Source keypoints:    ${result.sourceFeatures}`);
    }
    console.log('');

    console.log(`${colors.yellow}Suggestions:${colors.reset}`);
    console.log('  • Try reducing --min-matches to 5');
    console.log('  • Increase --ratio to 0.8 for more lenient matching');
    console.log('  • Ensure template appears at similar scale in source');
    console.log('  • Check that images have sufficient texture/features');
    console.log('');
  }

  console.log(`${colors.gray}Execution time: ${result.executionTime}${colors.reset}`);
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);

  // Check for help or no arguments
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHeader();
    printHelp();
    process.exit(0);
  }

  if (args.length < 2) {
    console.error(`${colors.red}Error: Please provide both source and template images${colors.reset}`);
    console.log('Use --help for usage information');
    process.exit(2);
  }

  const sourcePath = args[0];
  const templatePath = args[1];

  // Check if files exist
  if (!fs.existsSync(sourcePath)) {
    console.error(`${colors.red}Error: Source image not found: ${sourcePath}${colors.reset}`);
    process.exit(2);
  }

  if (!fs.existsSync(templatePath)) {
    console.error(`${colors.red}Error: Template image not found: ${templatePath}${colors.reset}`);
    process.exit(2);
  }

  // Parse options
  const options = {
    minMatches: 10,
    ratioThreshold: 0.75,
    outputPath: null,
    verbose: false
  };

  let jsonOutput = false;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--min-matches' && args[i + 1]) {
      options.minMatches = parseInt(args[i + 1]);
      if (isNaN(options.minMatches) || options.minMatches < 1) {
        console.error(`${colors.red}Error: Invalid min-matches value${colors.reset}`);
        process.exit(2);
      }
      i++;
    } else if (args[i] === '--ratio' && args[i + 1]) {
      options.ratioThreshold = parseFloat(args[i + 1]);
      if (isNaN(options.ratioThreshold) || options.ratioThreshold < 0 || options.ratioThreshold > 1) {
        console.error(`${colors.red}Error: Ratio must be between 0 and 1${colors.reset}`);
        process.exit(2);
      }
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      options.outputPath = args[i + 1];
      i++;
    } else if (args[i] === '--verbose') {
      options.verbose = true;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    }
  }

  // Print header for non-JSON output
  if (!jsonOutput) {
    printHeader();
    console.log(`${colors.bright}Source Image:${colors.reset}   ${sourcePath}`);
    console.log(`${colors.bright}Template Image:${colors.reset} ${templatePath}`);
    console.log('');

    if (options.verbose) {
      console.log(`${colors.gray}Settings:${colors.reset}`);
      console.log(`  Min matches: ${options.minMatches}`);
      console.log(`  Ratio threshold: ${options.ratioThreshold}`);
      console.log('');
    }

    console.log(`${colors.cyan}Detecting ORB features...${colors.reset}`);
  }

  try {
    // Run ORB matching
    const result = await findImageWithORB(sourcePath, templatePath, options);

    // Format and display results
    formatResult(result, jsonOutput);

    // Exit with appropriate code
    process.exit(result.found ? 0 : 1);

  } catch (error) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: error.message }, null, 2));
    } else {
      console.error(`${colors.red}${colors.bright}Error:${colors.reset} ${error.message}`);
    }
    process.exit(2);
  }
}

// Run main function
main();