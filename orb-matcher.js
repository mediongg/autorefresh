#!/usr/bin/env node

/**
 * ORB (Oriented FAST and Rotated BRIEF) Feature Matching
 * Scale-invariant template matching using OpenCV.js
 *
 * This module finds a template image within a source image
 * using ORB feature detection and matching.
 */

const cv = require('@techstark/opencv-js');

// Wait for OpenCV.js to be ready
async function waitForOpenCV() {
  return new Promise((resolve) => {
    // Check if already loaded
    if (cv.Mat) {
      resolve();
      return;
    }

    // Wait for onRuntimeInitialized
    if (cv.onRuntimeInitialized) {
      cv.onRuntimeInitialized = () => {
        resolve();
      };
    } else {
      // Fallback: poll until ready
      const checkReady = setInterval(() => {
        if (cv.Mat) {
          clearInterval(checkReady);
          resolve();
        }
      }, 50);
    }
  });
}
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

// Try to load canvas, but make it optional
let createCanvas, loadImage;
try {
  const canvas = require('canvas');
  createCanvas = canvas.createCanvas;
  loadImage = canvas.loadImage;
} catch (error) {
  console.log('Canvas module not available, using Jimp for image processing');
}

/**
 * Load an image file and convert to OpenCV Mat
 * @param {string} imagePath - Path to image file
 * @returns {Promise<cv.Mat>} OpenCV Mat object
 */
async function loadImageAsMat(imagePath) {
  // Ensure OpenCV is ready
  await waitForOpenCV();

  // Use Jimp as primary method (more reliable installation)
  try {
    const jimpImg = await Jimp.read(imagePath);
    const width = jimpImg.bitmap.width;
    const height = jimpImg.bitmap.height;

    // Create Mat from Jimp buffer
    const mat = new cv.Mat(height, width, cv.CV_8UC4);
    const data = jimpImg.bitmap.data;

    // Copy pixel data to Mat
    for (let i = 0; i < data.length; i++) {
      mat.data[i] = data[i];
    }

    return mat;
  } catch (jimpError) {
    // Try Canvas as fallback if available
    if (loadImage && createCanvas) {
      console.log('Trying Canvas fallback...');
      const img = await loadImage(imagePath);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, img.width, img.height);

      // Convert to OpenCV Mat
      const mat = cv.matFromImageData(imageData);
      return mat;
    } else {
      throw jimpError;
    }
  }
}

/**
 * Save Mat as image file
 * @param {cv.Mat} mat - OpenCV Mat to save
 * @param {string} outputPath - Path to save image
 */
async function saveMatAsImage(mat, outputPath) {
  try {
    // Use Jimp to save (more reliable)
    const width = mat.cols;
    const height = mat.rows;

    // Create new Jimp image
    const img = new Jimp(width, height);

    // Copy Mat data to Jimp
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = mat.data[idx];
        const g = mat.data[idx + 1];
        const b = mat.data[idx + 2];
        const a = mat.data[idx + 3];

        // Jimp uses hex format for colors
        const hex = Jimp.rgbaToInt(r, g, b, a);
        img.setPixelColor(hex, x, y);
      }
    }

    // Save the image
    await img.writeAsync(outputPath);
  } catch (error) {
    // Try Canvas as fallback if available
    if (createCanvas) {
      const canvas = createCanvas(mat.cols, mat.rows);
      const ctx = canvas.getContext('2d');
      const imgData = ctx.createImageData(mat.cols, mat.rows);

      // Copy Mat data to ImageData
      for (let i = 0; i < mat.data.length; i++) {
        imgData.data[i] = mat.data[i];
      }

      ctx.putImageData(imgData, 0, 0);

      // Save canvas to file
      const buffer = canvas.toBuffer('image/png');
      fs.writeFileSync(outputPath, buffer);
    } else {
      console.error('Error saving image:', error.message);
    }
  }
}

/**
 * Find template in source image using ORB features
 * @param {string} sourcePath - Path to source image
 * @param {string} templatePath - Path to template image
 * @param {Object} options - Matching options
 * @returns {Promise<Object>} Matching result
 */
async function findImageWithORB(sourcePath, templatePath, options = {}) {
  // Ensure OpenCV is ready
  await waitForOpenCV();

  const startTime = Date.now();

  // Default options
  const minMatches = options.minMatches || 10;
  const ratioThreshold = options.ratioThreshold || 0.75;
  const visualize = options.visualize || false;
  const outputPath = options.outputPath || null;
  const verbose = options.verbose || false;

  try {
    // Load images
    if (verbose) console.log('Loading images...');
    const srcMat = await loadImageAsMat(sourcePath);
    const templMat = await loadImageAsMat(templatePath);

    if (verbose) {
      console.log(`Source image: ${srcMat.cols}x${srcMat.rows}`);
      console.log(`Template image: ${templMat.cols}x${templMat.rows}`);
    }

    // Convert to grayscale
    const srcGray = new cv.Mat();
    const templGray = new cv.Mat();

    if (srcMat.channels() === 4) {
      cv.cvtColor(srcMat, srcGray, cv.COLOR_RGBA2GRAY);
    } else if (srcMat.channels() === 3) {
      cv.cvtColor(srcMat, srcGray, cv.COLOR_RGB2GRAY);
    } else {
      srcGray.delete();
      srcMat.copyTo(srcGray);
    }

    if (templMat.channels() === 4) {
      cv.cvtColor(templMat, templGray, cv.COLOR_RGBA2GRAY);
    } else if (templMat.channels() === 3) {
      cv.cvtColor(templMat, templGray, cv.COLOR_RGB2GRAY);
    } else {
      templGray.delete();
      templMat.copyTo(templGray);
    }

    // Create ORB detector
    if (verbose) console.log('Creating ORB detector...');
    const orb = new cv.ORB(
      5000,     // nfeatures
      1.2,      // scaleFactor
      8,        // nlevels
      31,       // edgeThreshold
      0,        // firstLevel
      2,        // WTA_K
      cv.ORB_HARRIS_SCORE,  // scoreType
      31,       // patchSize
      20        // fastThreshold
    );

    // Detect keypoints and compute descriptors
    if (verbose) console.log('Detecting features...');
    const kp1 = new cv.KeyPointVector();
    const kp2 = new cv.KeyPointVector();
    const desc1 = new cv.Mat();
    const desc2 = new cv.Mat();

    orb.detectAndCompute(templGray, new cv.Mat(), kp1, desc1);
    orb.detectAndCompute(srcGray, new cv.Mat(), kp2, desc2);

    if (verbose) {
      console.log(`Template keypoints: ${kp1.size()}`);
      console.log(`Source keypoints: ${kp2.size()}`);
    }

    // Check if enough features detected
    if (kp1.size() === 0 || kp2.size() === 0) {
      return {
        found: false,
        reason: 'No features detected in one or both images',
        executionTime: `${Date.now() - startTime}ms`
      };
    }

    // Match features using BFMatcher
    if (verbose) console.log('Matching features...');
    const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
    const matches = new cv.DMatchVectorVector();

    // Use knnMatch for ratio test
    matcher.knnMatch(desc1, desc2, matches, 2);

    // Apply Lowe's ratio test
    const goodMatches = new cv.DMatchVector();
    for (let i = 0; i < matches.size(); i++) {
      const match = matches.get(i);
      if (match.size() >= 2) {
        const m = match.get(0);
        const n = match.get(1);
        if (m.distance < ratioThreshold * n.distance) {
          goodMatches.push_back(m);
        }
      }
    }

    if (verbose) {
      console.log(`Good matches: ${goodMatches.size()}`);
    }

    const result = {
      found: goodMatches.size() >= minMatches,
      matches: goodMatches.size(),
      minMatchesRequired: minMatches,
      templateFeatures: kp1.size(),
      sourceFeatures: kp2.size(),
      executionTime: `${Date.now() - startTime}ms`
    };

    // Find homography if enough matches
    if (goodMatches.size() >= 4) {
      // Extract matched keypoints
      const srcPoints = [];
      const dstPoints = [];

      for (let i = 0; i < goodMatches.size(); i++) {
        const match = goodMatches.get(i);
        const pt1 = kp1.get(match.queryIdx).pt;
        const pt2 = kp2.get(match.trainIdx).pt;
        srcPoints.push(pt1.x, pt1.y);
        dstPoints.push(pt2.x, pt2.y);
      }

      // Create point matrices
      const srcPts = cv.matFromArray(srcPoints.length / 2, 1, cv.CV_32FC2, srcPoints);
      const dstPts = cv.matFromArray(dstPoints.length / 2, 1, cv.CV_32FC2, dstPoints);

      // Find homography
      const mask = new cv.Mat();
      const H = cv.findHomography(srcPts, dstPts, cv.RANSAC, 5.0, mask);

      if (!H.empty()) {
        // Get template corners
        const corners = cv.matFromArray(4, 1, cv.CV_32FC2, [
          0, 0,
          templMat.cols, 0,
          templMat.cols, templMat.rows,
          0, templMat.rows
        ]);

        // Transform corners to source image
        const transformedCorners = new cv.Mat();
        cv.perspectiveTransform(corners, transformedCorners, H);

        // Extract corner coordinates
        const cornersArray = [];
        for (let i = 0; i < 4; i++) {
          cornersArray.push({
            x: transformedCorners.data32F[i * 2],
            y: transformedCorners.data32F[i * 2 + 1]
          });
        }

        // Calculate bounding box and center
        const xCoords = cornersArray.map(p => p.x);
        const yCoords = cornersArray.map(p => p.y);

        result.position = {
          x: Math.min(...xCoords),
          y: Math.min(...yCoords)
        };

        result.center = {
          x: (Math.min(...xCoords) + Math.max(...xCoords)) / 2,
          y: (Math.min(...yCoords) + Math.max(...yCoords)) / 2
        };

        result.boundingBox = {
          topLeft: cornersArray[0],
          topRight: cornersArray[1],
          bottomRight: cornersArray[2],
          bottomLeft: cornersArray[3]
        };

        // Count inliers
        let inliers = 0;
        for (let i = 0; i < mask.rows; i++) {
          if (mask.data[i] !== 0) inliers++;
        }
        result.inlierMatches = inliers;

        // Calculate confidence based on matches and inliers
        result.confidence = Math.min(1.0, (goodMatches.size() / minMatches) * 0.5 +
                                         (inliers / goodMatches.size()) * 0.5);

        // Create visualization if requested
        if (outputPath) {
          if (verbose) console.log('Creating visualization...');

          // Draw matches
          const outputMat = new cv.Mat();
          cv.drawMatches(
            templMat, kp1,
            srcMat, kp2,
            goodMatches, outputMat,
            new cv.Scalar(0, 255, 0, 255),
            new cv.Scalar(255, 0, 0, 255),
            new cv.MatVector(),
            cv.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS
          );

          // Draw bounding box on output
          const color = result.found ?
            new cv.Scalar(0, 255, 0, 255) :
            new cv.Scalar(255, 165, 0, 255);

          for (let i = 0; i < 4; i++) {
            const pt1 = cornersArray[i];
            const pt2 = cornersArray[(i + 1) % 4];

            // Adjust x coordinate for side-by-side visualization
            const adjustedPt1 = {
              x: pt1.x + templMat.cols,
              y: pt1.y
            };
            const adjustedPt2 = {
              x: pt2.x + templMat.cols,
              y: pt2.y
            };

            cv.line(
              outputMat,
              new cv.Point(adjustedPt1.x, adjustedPt1.y),
              new cv.Point(adjustedPt2.x, adjustedPt2.y),
              color,
              3
            );
          }

          await saveMatAsImage(outputMat, outputPath);
          result.visualizationSaved = outputPath;
          outputMat.delete();
        }

        // Cleanup
        corners.delete();
        transformedCorners.delete();
        H.delete();
        mask.delete();
      }

      srcPts.delete();
      dstPts.delete();
    }

    // Cleanup
    srcMat.delete();
    templMat.delete();
    srcGray.delete();
    templGray.delete();
    kp1.delete();
    kp2.delete();
    desc1.delete();
    desc2.delete();
    matches.delete();
    goodMatches.delete();
    orb.delete();
    matcher.delete();

    return result;

  } catch (error) {
    return {
      found: false,
      error: error.message,
      executionTime: `${Date.now() - startTime}ms`
    };
  }
}

// Export for use as module
module.exports = {
  findImageWithORB,
  loadImageAsMat,
  saveMatAsImage
};

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node orb-matcher.js <source-image> <template-image> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --min-matches <num>     Minimum matches required (default: 10)');
    console.log('  --ratio <0-1>           Ratio test threshold (default: 0.75)');
    console.log('  --output <path>         Save visualization');
    console.log('  --verbose               Show detailed progress');
    console.log('');
    process.exit(1);
  }

  const sourcePath = args[0];
  const templatePath = args[1];

  const options = {
    minMatches: 10,
    ratioThreshold: 0.75,
    outputPath: null,
    verbose: false
  };

  // Parse options
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--min-matches' && args[i + 1]) {
      options.minMatches = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--ratio' && args[i + 1]) {
      options.ratioThreshold = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      options.outputPath = args[i + 1];
      i++;
    } else if (args[i] === '--verbose') {
      options.verbose = true;
    }
  }

  // Run matching
  findImageWithORB(sourcePath, templatePath, options)
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.found ? 0 : 1);
    })
    .catch(error => {
      console.error('Error:', error.message);
      process.exit(2);
    });
}