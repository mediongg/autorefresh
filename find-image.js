#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const pixelmatch = require('pixelmatch');

/**
 * Find template image (B) within source image (A)
 * Supports PNG and JPEG formats
 * Usage: node find-image.js <source-image-A> <template-image-B> [options]
 */

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node find-image.js <source-image-A> <template-image-B> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --threshold <0-1>       Color difference threshold (default: 0.1)');
    console.log('  --min-match <0-1>       Minimum match percentage (default: 0.8)');
    console.log('  --step <pixels>         Search step size for speed (default: 1)');
    console.log('  --output <path>         Save visualization image (optional)');
    console.log('  --verbose               Show detailed progress');
    console.log('');
    console.log('Example:');
    console.log('  node find-image.js page-B.png character.png --min-match 0.75');
    process.exit(1);
  }

  const config = {
    sourceImage: args[0],
    templateImage: args[1],
    threshold: 0.1,
    minMatch: 0.8,
    step: 1,
    output: null,
    verbose: false
  };

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--threshold' && args[i + 1]) {
      config.threshold = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === '--min-match' && args[i + 1]) {
      config.minMatch = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === '--step' && args[i + 1]) {
      config.step = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      config.output = args[i + 1];
      i++;
    } else if (args[i] === '--verbose') {
      config.verbose = true;
    }
  }

  return config;
}

function loadImage(imagePath) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }

  const ext = path.extname(imagePath).toLowerCase();
  const buffer = fs.readFileSync(imagePath);

  try {
    if (ext === '.png') {
      return PNG.sync.read(buffer);
    } else if (ext === '.jpg' || ext === '.jpeg') {
      // Decode JPEG
      const rawImageData = jpeg.decode(buffer, { useTArray: true });

      // Convert to PNG-compatible format for pixelmatch
      const img = new PNG({ width: rawImageData.width, height: rawImageData.height });
      img.data = Buffer.from(rawImageData.data);

      return img;
    } else {
      throw new Error(`Unsupported format: ${ext}. Only PNG and JPEG are supported.`);
    }
  } catch (error) {
    if (error.message.includes('Unsupported format')) {
      throw error;
    }
    throw new Error(`Failed to load image ${imagePath}: ${error.message}`);
  }
}

function extractRegion(sourceImg, x, y, width, height) {
  const region = new PNG({ width, height });

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const srcIdx = ((y + dy) * sourceImg.width + (x + dx)) * 4;
      const dstIdx = (dy * width + dx) * 4;

      region.data[dstIdx] = sourceImg.data[srcIdx];
      region.data[dstIdx + 1] = sourceImg.data[srcIdx + 1];
      region.data[dstIdx + 2] = sourceImg.data[srcIdx + 2];
      region.data[dstIdx + 3] = sourceImg.data[srcIdx + 3];
    }
  }

  return region;
}

function drawRectangle(img, x, y, width, height, color = { r: 0, g: 255, b: 0 }) {
  const thickness = 3;

  for (let i = 0; i < thickness; i++) {
    // Top and bottom edges
    for (let dx = 0; dx < width; dx++) {
      // Top
      const topIdx = ((y + i) * img.width + (x + dx)) * 4;
      if (topIdx >= 0 && topIdx < img.data.length - 3) {
        img.data[topIdx] = color.r;
        img.data[topIdx + 1] = color.g;
        img.data[topIdx + 2] = color.b;
        img.data[topIdx + 3] = 255;
      }

      // Bottom
      const bottomIdx = ((y + height - 1 - i) * img.width + (x + dx)) * 4;
      if (bottomIdx >= 0 && bottomIdx < img.data.length - 3) {
        img.data[bottomIdx] = color.r;
        img.data[bottomIdx + 1] = color.g;
        img.data[bottomIdx + 2] = color.b;
        img.data[bottomIdx + 3] = 255;
      }
    }

    // Left and right edges
    for (let dy = 0; dy < height; dy++) {
      // Left
      const leftIdx = ((y + dy) * img.width + (x + i)) * 4;
      if (leftIdx >= 0 && leftIdx < img.data.length - 3) {
        img.data[leftIdx] = color.r;
        img.data[leftIdx + 1] = color.g;
        img.data[leftIdx + 2] = color.b;
        img.data[leftIdx + 3] = 255;
      }

      // Right
      const rightIdx = ((y + dy) * img.width + (x + width - 1 - i)) * 4;
      if (rightIdx >= 0 && rightIdx < img.data.length - 3) {
        img.data[rightIdx] = color.r;
        img.data[rightIdx + 1] = color.g;
        img.data[rightIdx + 2] = color.b;
        img.data[rightIdx + 3] = 255;
      }
    }
  }
}

function findTemplate(sourceImg, templateImg, config) {
  const sw = sourceImg.width;
  const sh = sourceImg.height;
  const tw = templateImg.width;
  const th = templateImg.height;

  if (tw > sw || th > sh) {
    throw new Error(`Template (${tw}x${th}) is larger than source (${sw}x${sh})`);
  }

  console.log(`Searching for template (${tw}x${th}) in source (${sw}x${sh})...`);
  console.log(`Threshold: ${config.threshold}, Min match: ${config.minMatch * 100}%, Step: ${config.step}`);
  console.log('');

  let bestMatch = {
    found: false,
    confidence: 0,
    position: null,
    center: null
  };

  let searchedLocations = 0;
  let lastProgress = 0;
  const totalLocations = Math.ceil((sh - th) / config.step) * Math.ceil((sw - tw) / config.step);

  for (let y = 0; y <= sh - th; y += config.step) {
    for (let x = 0; x <= sw - tw; x += config.step) {
      searchedLocations++;

      // Show progress
      if (config.verbose) {
        const progress = Math.floor((searchedLocations / totalLocations) * 100);
        if (progress > lastProgress && progress % 10 === 0) {
          console.log(`Progress: ${progress}% (${searchedLocations}/${totalLocations} locations)`);
          lastProgress = progress;
        }
      }

      // Extract region from source
      const region = extractRegion(sourceImg, x, y, tw, th);

      // Compare with template
      const diff = new PNG({ width: tw, height: th });
      const mismatchedPixels = pixelmatch(
        templateImg.data,
        region.data,
        diff.data,
        tw,
        th,
        { threshold: config.threshold }
      );

      const totalPixels = tw * th;
      const matchPercentage = 1 - (mismatchedPixels / totalPixels);

      if (matchPercentage > bestMatch.confidence) {
        bestMatch = {
          found: matchPercentage >= config.minMatch,
          confidence: matchPercentage,
          position: { x, y },
          center: { x: x + Math.floor(tw / 2), y: y + Math.floor(th / 2) },
          mismatchedPixels,
          totalPixels
        };

        if (config.verbose) {
          console.log(`New best match: ${(matchPercentage * 100).toFixed(2)}% at (${x}, ${y})`);
        }
      }

      // Early exit if near-perfect match
      if (matchPercentage > 0.99) {
        if (config.verbose) {
          console.log('Found near-perfect match, stopping search.');
        }
        break;
      }
    }

    if (bestMatch.confidence > 0.99) break;
  }

  console.log(`Searched ${searchedLocations} locations`);
  console.log('');

  return bestMatch;
}

function saveVisualization(sourceImg, match, templateWidth, templateHeight, outputPath) {
  // Create a copy of source image
  const result = new PNG({
    width: sourceImg.width,
    height: sourceImg.height
  });
  result.data = Buffer.from(sourceImg.data);

  // Draw rectangle around match
  const color = match.found ? { r: 0, g: 255, b: 0 } : { r: 255, g: 165, b: 0 };
  drawRectangle(result, match.position.x, match.position.y, templateWidth, templateHeight, color);

  // Save based on output extension
  const ext = path.extname(outputPath).toLowerCase();
  let buffer;

  if (ext === '.jpg' || ext === '.jpeg') {
    // Encode as JPEG
    const rawImageData = {
      data: result.data,
      width: result.width,
      height: result.height
    };
    buffer = jpeg.encode(rawImageData, 90).data; // 90% quality
  } else {
    // Default to PNG
    buffer = PNG.sync.write(result);
  }

  fs.writeFileSync(outputPath, buffer);
  console.log(`Visualization saved to: ${outputPath}`);
}

// Main execution
try {
  const config = parseArgs();

  console.log('=== Image Template Matching ===');
  console.log('');
  console.log(`Source image (A):   ${config.sourceImage}`);
  console.log(`Template image (B): ${config.templateImage}`);
  console.log('');

  // Load images
  const sourceImg = loadImage(config.sourceImage);
  const templateImg = loadImage(config.templateImage);

  // Find template in source
  const startTime = Date.now();
  const result = findTemplate(sourceImg, templateImg, config);
  const elapsed = Date.now() - startTime;

  // Display results
  console.log('=== RESULTS ===');
  console.log('');

  if (result.found) {
    console.log('✓ TEMPLATE FOUND IN SOURCE');
    console.log('');
    console.log(`  Confidence:  ${(result.confidence * 100).toFixed(2)}%`);
    console.log(`  Position:    (${result.position.x}, ${result.position.y})`);
    console.log(`  Center:      (${result.center.x}, ${result.center.y})`);
    console.log(`  Mismatched:  ${result.mismatchedPixels} / ${result.totalPixels} pixels`);
  } else {
    console.log('✗ TEMPLATE NOT FOUND IN SOURCE');
    console.log('');
    console.log(`  Best match:  ${(result.confidence * 100).toFixed(2)}% (below ${config.minMatch * 100}% threshold)`);
    if (result.position) {
      console.log(`  Position:    (${result.position.x}, ${result.position.y})`);
    }
    console.log('');
    console.log('  Try adjusting parameters:');
    console.log('    --min-match 0.7    (lower threshold)');
    console.log('    --threshold 0.2    (more color tolerance)');
  }

  console.log('');
  console.log(`Search completed in ${elapsed}ms`);

  // Save visualization if requested
  if (config.output && result.position) {
    console.log('');
    saveVisualization(sourceImg, result, templateImg.width, templateImg.height, config.output);
  }

  // Exit code: 0 if found, 1 if not found
  process.exit(result.found ? 0 : 1);

} catch (error) {
  console.error('');
  console.error('ERROR:', error.message);
  console.error('');
  process.exit(2);
}
