# ORB Image Matching Setup Guide

## Overview

ORB (Oriented FAST and Rotated BRIEF) is a feature-based image matching algorithm that can find a template image within a larger source image, even at different scales and rotations.

**Key Features:**
- ✅ Scale-invariant (finds images at different sizes)
- ✅ Rotation-invariant (works with rotated images)
- ✅ Fast execution (100-500ms typical)
- ✅ No ML training required
- ✅ Pure JavaScript implementation

## Installation

### 1. Install Dependencies

```bash
npm install
```

This installs:
- `@techstark/opencv-js` - OpenCV.js for ORB algorithm
- `canvas` - For image loading/saving
- `jimp` - Fallback image processing

### 2. System Dependencies (for Canvas)

The `canvas` package requires system libraries:

**macOS:**
```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

**Ubuntu/Debian:**
```bash
sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

**Windows:**
- Canvas should install automatically with pre-built binaries
- If issues occur, see: https://github.com/Automattic/node-canvas/wiki/Installation:-Windows

### 3. Verify Installation

```bash
node test-orb.js
```

This will:
- Check all modules load correctly
- Run synthetic image tests
- Test with your images if available

## Quick Start

### Basic Usage

Find template in source image:
```bash
node find-image-orb.js source-image.jpg template-image.jpg
```

### With Visualization

Save result with bounding box:
```bash
node find-image-orb.js canvas.png character.png --output result.png
```

### Unity Character Example

For your p1-p5 character scenario:
```bash
# Find character p3 in the full canvas
node find-image-orb.js unity-canvas.png p3-character.png --output found.png
```

## Command-Line Options

| Option | Default | Description |
|--------|---------|-------------|
| `--min-matches` | 10 | Minimum feature matches required |
| `--ratio` | 0.75 | Lowe's ratio test threshold (0-1) |
| `--output` | none | Save visualization with bounding box |
| `--verbose` | false | Show detailed progress |
| `--json` | false | Output raw JSON |
| `--help` | - | Show help message |

## Understanding Parameters

### `--min-matches` (default: 10)
Number of matching features required to consider it a match:
- **Lower (5-8)**: More lenient, might get false positives
- **Default (10)**: Good balance
- **Higher (15-20)**: Very strict, might miss valid matches

### `--ratio` (default: 0.75)
Controls matching quality (Lowe's ratio test):
- **Lower (0.6-0.7)**: Stricter, fewer but better matches
- **Default (0.75)**: Good balance
- **Higher (0.8-0.9)**: More matches but potentially noisier

## Examples

### Example 1: Find Dog in Composite Image
```bash
node find-image-orb.js doga.jpeg dogb.jpeg --output dog-result.png
```

### Example 2: Lenient Matching for Similar Images
```bash
node find-image-orb.js screenshot.png template.png --min-matches 5 --ratio 0.8
```

### Example 3: Strict Matching to Avoid False Positives
```bash
node find-image-orb.js canvas.jpg target.jpg --min-matches 15 --ratio 0.7
```

### Example 4: Debug Mode with Verbose Output
```bash
node find-image-orb.js source.png template.png --verbose --output debug.png
```

## Integration with Your Code

### As a Module

```javascript
const { findImageWithORB } = require('./orb-matcher');

async function checkCharacterPresent() {
  const result = await findImageWithORB(
    'unity-canvas.png',
    'character-p3.png',
    {
      minMatches: 10,
      ratioThreshold: 0.75,
      outputPath: 'result.png'
    }
  );

  if (result.found) {
    console.log(`Character found at (${result.center.x}, ${result.center.y})`);
    console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    return result.center;
  } else {
    console.log('Character not found');
    return null;
  }
}
```

### With Playwright

```javascript
const { chromium } = require('playwright');
const { findImageWithORB } = require('./orb-matcher');

async function findCharacterInCanvas(page) {
  // Take screenshot of canvas
  const canvas = await page.locator('canvas').first();
  await canvas.screenshot({ path: 'canvas-screenshot.png' });

  // Find character p3
  const result = await findImageWithORB(
    'canvas-screenshot.png',
    'p3-template.png',
    { minMatches: 10 }
  );

  if (result.found) {
    // Click on the character
    await page.mouse.click(result.center.x, result.center.y);
    console.log('Clicked on character p3');
  }

  return result.found;
}
```

## Troubleshooting

### "No features detected"
- Image might be too simple (solid colors, no texture)
- Try adding more detailed/textured templates
- Ensure images aren't corrupted

### "Not enough matches"
- Reduce `--min-matches` to 5
- Increase `--ratio` to 0.8
- Ensure template appears at similar scale in source

### Canvas installation fails
- Check system dependencies are installed (cairo, pango, etc.)
- Try: `npm install canvas --build-from-source`
- Use Jimp fallback if Canvas won't install

### Slow performance
- Reduce image size if possible
- Use JPEG instead of PNG for faster loading
- Consider caching results for repeated searches

## Performance Tips

1. **Image Size**: Smaller images process faster
   - Resize large images before matching if possible
   - 1920x1080 typically takes 200-400ms

2. **Template Size**: Smaller templates are faster
   - Crop templates tightly around the object
   - Remove unnecessary background

3. **Feature Count**: Images with more texture match better
   - Avoid plain/solid color areas
   - Include distinctive features in template

## How ORB Works

1. **Feature Detection**: Finds interesting points (corners, edges)
2. **Descriptor Extraction**: Creates mathematical descriptions of each point
3. **Feature Matching**: Compares descriptors between images
4. **Geometric Verification**: Checks if matches form valid transformation
5. **Location Calculation**: Computes bounding box in source image

## Limitations

- Works best with textured images (not plain colors)
- Template must be roughly same resolution as in source
- Extreme perspective changes might fail
- Very small templates (<50px) might not have enough features

## Output Format

```json
{
  "found": true,
  "matches": 47,
  "confidence": 0.85,
  "position": {"x": 520, "y": 180},
  "center": {"x": 620, "y": 280},
  "boundingBox": {
    "topLeft": {"x": 520, "y": 180},
    "topRight": {"x": 720, "y": 180},
    "bottomRight": {"x": 720, "y": 380},
    "bottomLeft": {"x": 520, "y": 380}
  },
  "executionTime": "245ms"
}
```

## Comparison with Pixel Matching

| Feature | ORB (This Tool) | Pixel Matching |
|---------|----------------|----------------|
| Different sizes | ✅ Yes | ❌ No |
| Rotation | ✅ Yes | ❌ No |
| Speed | 200-500ms | 100-1000ms |
| Accuracy | High | Very High |
| Setup | npm install | Simple |

## Support

For issues or questions:
1. Run `node test-orb.js` to verify setup
2. Use `--verbose` flag for debugging
3. Check images have sufficient features
4. Try adjusting parameters

## License

This implementation uses:
- OpenCV.js (Apache 2.0 License)
- node-canvas (MIT License)
- Jimp (MIT License)