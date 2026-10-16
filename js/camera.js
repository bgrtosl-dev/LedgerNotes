/**
- Ledger Notes App - Camera & OpenCV Analysis Module

- Unified Staff Mode:
- Reference cross centered at rows * 0.5 (middle staff line).
- Slant-stack orientation and line detection.
- Optional "Lock Staff Center" mode.
- Ledger lines from -13 to +10 with independently scaled Bass (+10%) & Treble (+20%) note naming + octaves.
 */

const show_histogram = false;
const show_slant = false;
const display_bw = false;
let lockCenterEnabled = false;

let mediaStream = null;
let processingInterval = null;
let latestAnalysisData = null;
let smoothedStaffLines = null; // Stabilization buffer for staff lines

const cameraOverlay = document.getElementById("camera-overlay");
const cameraVideo = document.getElementById("camera-video");
const cameraCanvas = document.getElementById("camera-canvas");
const overlayCanvas = document.getElementById("camera-overlay-canvas");
const liveOffsetDisplay = document.getElementById("live-offset-display");

// Hide upper-right HUD element entirely
if (liveOffsetDisplay) {
  liveOffsetDisplay.style.display = "none";
}

// Create and inject Lock Center Toggle UI into camera overlay if not present
let lockToggleContainer = document.getElementById("lockToggleContainer");
if (!lockToggleContainer && cameraOverlay) {
  lockToggleContainer = document.createElement("div");
  lockToggleContainer.id = "lockToggleContainer";
  lockToggleContainer.style.cssText = "position: absolute; top: 15px; left: 15px; z-index: 1000; color: white; display: flex; align-items: center; gap: 8px; font-family: Arial, sans-serif;";
  lockToggleContainer.innerHTML = `
    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.7); padding: 8px 14px; border-radius: 6px; font-size: 14px; border: 1px solid rgba(255,255,255,0.2);">
      <input type="checkbox" id="lockCenterToggle" style="cursor: pointer; width: 16px; height: 16px;"> Lock Staff Center
    </label>
  `;
  cameraOverlay.appendChild(lockToggleContainer);

  document.getElementById("lockCenterToggle").addEventListener("change", (e) => {
    lockCenterEnabled = e.target.checked;
    smoothedStaffLines = null; // Reset smoothing when toggling
  });
}

document.getElementById("cameraBtn").addEventListener("click", async () => {
  if (!window.openCVReady || typeof cv === "undefined") {
    alert("OpenCV is still loading or failed to initialize. Please wait a moment and try again.");
    return;
  }
  cameraOverlay.style.display = "flex";
  latestAnalysisData = null;
  smoothedStaffLines = null;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { exact: "environment" },
        advanced: [{ stabilization: true }]
      }
    });
  } catch (err) {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (e) {
      alert("Camera access denied or unavailable.");
      cameraOverlay.style.display = "none";
    }
  }
  if (mediaStream) {
    cameraVideo.srcObject = mediaStream;
    startRealtimeAnalysis();
  }
});

document.getElementById("closeCameraBtn").addEventListener("click", () => {
  stopCamera();
});

cameraOverlay.addEventListener("click", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "LABEL" || e.target.tagName === "BUTTON") return;
  if (latestAnalysisData && latestAnalysisData.targetPitch !== undefined) {
    const targetPitch = latestAnalysisData.targetPitch;
    const letterIndexVal = ((targetPitch % 7) + 7) % 7;
    window.selectedLetter = window.natural[letterIndexVal];

    document.getElementById("noteSelect").value = window.selectedLetter;
    window.draw();
  }
  stopCamera();
});

function stopCamera() {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  smoothedStaffLines = null;
  cameraOverlay.style.display = "none";
}

function detectStavesSlantStack(binaryRoi, cols, rows) {
  let rCols = binaryRoi.cols;
  let rRows = binaryRoi.rows;
  let centerX = rCols / 2;

  let bestAngle = 0;
  let maxVariance = -1;
  let bestProfile = new Array(rRows).fill(0);

  for (let angle = -10; angle <= 10; angle += 1) {
    let rad = -angle * Math.PI / 180;
    let tanTheta = Math.tan(rad);

    let profile = new Array(rRows).fill(0);

    for (let y = 0; y < rRows; y++) {
      let inkSum = 0;
      let validCount = 0;
      for (let x = 0; x < rCols; x++) {
        let sampleY = Math.round(y + (x - centerX) * tanTheta);
        if (sampleY >= 0 && sampleY < rRows) {
          let val = binaryRoi.ucharAt(sampleY, x);
          if (val < 128) {
            inkSum += 1;
          }
          validCount++;
        }
      }
      profile[y] = validCount > 0 ? (inkSum / validCount) * 255 : 0;
    }

    let mean = profile.reduce((a, b) => a + b, 0) / rRows;
    let variance = profile.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rRows;

    if (variance > maxVariance) {
      maxVariance = variance;
      bestAngle = angle;
      bestProfile = profile;
    }
  }

  let minima = [];
  let pRows = bestProfile.length;
  let meanVal = bestProfile.reduce((a, b) => a + b, 0) / pRows;
  for (let y = 2; y < pRows - 2; y++) {
    if (bestProfile[y] > bestProfile[y-1] && bestProfile[y] > bestProfile[y-2] &&
        bestProfile[y] >= bestProfile[y+1] && bestProfile[y] >= bestProfile[y+2] &&
        bestProfile[y] > meanVal * 1.1) {
      minima.push(y);
    }
  }

  let staves = [];
  for (let i = 0; i <= minima.length - 5; i++) {
    let group = minima.slice(i, i + 5);
    let d1 = group[1] - group[0];
    let d2 = group[2] - group[1];
    let d3 = group[3] - group[2];
    let d4 = group[4] - group[3];
    let avgD = (d1 + d2 + d3 + d4) / 4;

    let d = avgD;
    let Emin = Math.pow(d - d1, 2) + Math.pow(d - d2, 2) + Math.pow(d - d3, 2) + Math.pow(d - d4, 2);
    let E0 = Math.pow(d1, 2) + Math.pow(d2, 2) + Math.pow(d3, 2) + Math.pow(d4, 2);
    let rho = E0 > 0 ? (E0 - Emin) / E0 : 0;

    let groupAmp = (bestProfile[group[0]] + bestProfile[group[1]] + bestProfile[group[2]] + bestProfile[group[3]] + bestProfile[group[4]]) / 5;
    let isStaffAmplitudeValid = groupAmp >= (meanVal * 1.8);

    if (avgD > 6 && avgD < 60 && rho > 0.82 && isStaffAmplitudeValid) {
      staves.push({ lines: group, spacing: avgD, angle: bestAngle });
      i += 4;
    }
  }

  return { staves, profile: bestProfile, bestAngle, minima };
}

function startRealtimeAnalysis() {
  processingInterval = setInterval(() => {
    if (!cameraVideo.videoWidth || cameraOverlay.style.display === "none") return;

    overlayCanvas.width = cameraVideo.videoWidth;
    overlayCanvas.height = cameraVideo.videoHeight;
    const overlayCtx = overlayCanvas.getContext("2d");
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    cameraCanvas.width = cameraVideo.videoWidth;
    cameraCanvas.height = cameraVideo.videoHeight;
    const ctx = cameraCanvas.getContext("2d");
    ctx.drawImage(cameraVideo, 0, 0);

    if (window.openCVReady && typeof cv !== "undefined" && cv.Mat) {
      try {
        let src = cv.imread(cameraCanvas);
        let fullGray = new cv.Mat();
        cv.cvtColor(src, fullGray, cv.COLOR_RGBA2GRAY, 0);

        let rows = fullGray.rows;
        let cols = fullGray.cols;
        let midX = cols * 0.5;
        let centerY = Math.floor(rows * 0.5);

        let bandStart = Math.floor(cols * 0.425);
        let bandEnd = Math.floor(cols * 0.575);
        let bandWidth = bandEnd - bandStart;
        let bandHalfWidth = bandWidth / 2;
        let maxGraphWidth = bandHalfWidth * 0.4;
        let graphCenterX = bandStart + bandHalfWidth;

        let roiRect = new cv.Rect(bandStart, 0, bandWidth, rows);
        let yOffset = 0;

        // Draw Center Cross
        overlayCtx.strokeStyle = "red";
        overlayCtx.lineWidth = 2;
        overlayCtx.beginPath();
        overlayCtx.moveTo(0, centerY);
        overlayCtx.lineTo(cols, centerY);
        overlayCtx.stroke();
        overlayCtx.beginPath();
        overlayCtx.moveTo(midX, 0);
        overlayCtx.lineTo(midX, rows);
        overlayCtx.stroke();

        let gray = fullGray.roi(roiRect);

        let srcVec = new cv.MatVector();
        srcVec.push_back(gray);
        let hist = new cv.Mat();
        let channels = [0];
        let histSize = [20];
        let ranges = [0, 256];
        cv.calcHist(srcVec, channels, new cv.Mat(), hist, histSize, ranges);
        srcVec.delete();

        let maxBinVal = -1;
        let maxBinIdx = 0;
        for (let b = 0; b < 20; b++) {
          let val = hist.floatAt(b, 0);
          if (val > maxBinVal) {
            maxBinVal = val;
            maxBinIdx = b;
          }
        }

        let thresholdVal = (maxBinIdx / 20) * 256 * 0.85;
        let thresholdBin = Math.floor((thresholdVal / 256) * 20);

        let binaryRoi = new cv.Mat();
        cv.threshold(gray, binaryRoi, thresholdVal, 255, cv.THRESH_BINARY);

        if (display_bw) {
          let tempCvCanvas = document.createElement('canvas');
          tempCvCanvas.width = binaryRoi.cols;
          tempCvCanvas.height = binaryRoi.rows;
          cv.imshow(tempCvCanvas, binaryRoi);
          overlayCtx.drawImage(tempCvCanvas, bandStart, yOffset);
        }

        if (show_histogram) {
          let histX = 20;
          let histWidth = bandWidth * 0.5;
          let histHeight = histWidth * 0.75;

          overlayCtx.fillStyle = "#FF6600";
          overlayCtx.fillRect(histX, centerY - histHeight, histWidth, histHeight);

          let binWidth = histWidth / 20;
          for (let b = 0; b < 20; b++) {
            let binVal = hist.floatAt(b, 0);
            let binH = (binVal / (maxBinVal > 0 ? maxBinVal : 1)) * histHeight;
            let bx = histX + (b * binWidth);
            let by = centerY - binH;

            overlayCtx.fillStyle = (b < thresholdBin) ? "#000000" : "#FFFFFF";
            overlayCtx.fillRect(bx, by, binWidth - 1, binH);
          }
        }
        hist.delete();

        let { staves, profile, bestAngle, minima } = detectStavesSlantStack(binaryRoi, binaryRoi.cols, binaryRoi.rows);

        if (profile && profile.length > 0) {
          let maxVal = Math.max(...profile, 1);
          let rad = -bestAngle * Math.PI / 180;
          let tanVal = Math.tan(rad);

          if (show_slant) {
            overlayCtx.save();
            overlayCtx.beginPath();
            overlayCtx.rect(bandStart, yOffset, bandWidth, rows);
            overlayCtx.clip();

            overlayCtx.fillStyle = "rgba(255, 0, 0, 0.25)";
            overlayCtx.strokeStyle = "rgba(255, 0, 0, 0.8)";
            overlayCtx.lineWidth = 1.5;

            overlayCtx.beginPath();
            overlayCtx.moveTo(graphCenterX, yOffset);

            for (let y = 0; y < binaryRoi.rows; y++) {
              let amplitude = (profile[y] / maxVal) * maxGraphWidth;
              let baseY = yOffset + y;
              let x = graphCenterX + amplitude;
              overlayCtx.lineTo(x, baseY);
            }

            overlayCtx.lineTo(graphCenterX, yOffset + binaryRoi.rows - 1);
            overlayCtx.closePath();
            overlayCtx.fill();
            overlayCtx.stroke();
            overlayCtx.restore();
          }

          if (staves.length > 0) {
            staves.forEach(staff => {
              staff.lines = staff.lines.map(y => y + yOffset);
            });

            let validStaves = [];
            if (lockCenterEnabled) {
              if (minima.length > 0) {
                let shiftedMinima = minima.map(m => m + yOffset);
                let closestMinimaY = shiftedMinima.reduce((prev, curr) =>
                  Math.abs(curr - centerY) < Math.abs(prev - centerY) ? curr : prev
                );
                let matchingStaff = staves.find(staff => Math.abs(staff.lines[2] - closestMinimaY) < 2);
                if (matchingStaff) {
                  validStaves = [matchingStaff];
                }
              }
            } else {
              validStaves = staves.filter(staff => {
                let middleLineY = staff.lines[2];
                return Math.abs(middleLineY - centerY) <= (4 * staff.spacing);
              });
            }

            if (validStaves.length > 0) {
              let rawClosestStaff = validStaves.reduce((prev, curr) =>
                Math.abs(curr.lines[2] - centerY) < Math.abs(prev.lines[2] - centerY) ? curr : prev
              );

              let alpha = 0.35;
              if (!smoothedStaffLines) {
                smoothedStaffLines = [...rawClosestStaff.lines];
              } else {
                for (let idx = 0; idx < 5; idx++) {
                  smoothedStaffLines[idx] = alpha * rawClosestStaff.lines[idx] + (1 - alpha) * smoothedStaffLines[idx];
                }
              }
              let closestStaff = { lines: smoothedStaffLines, spacing: rawClosestStaff.spacing, angle: rawClosestStaff.angle };

              let topLineY = closestStaff.lines[0];
              let bottomLineY = closestStaff.lines[4];

              const bassAboveMap = { 1: "C4", 2: "E4", 3: "G4", 4: "B4", 5: "D5", 6: "F5", 7: "A5", 8: "C6", 9: "E6", 10: "G6" };
              const trebleAboveMap = { 1: "A5", 2: "C6", 3: "E6", 4: "G6", 5: "B6", 6: "D7", 7: "F7", 8: "A7", 9: "C8", 10: "E8" };

              const bassBelowMap = { 1: "E2", 2: "C2", 3: "A1", 4: "F1", 5: "D1", 6: "B0", 7: "G0", 8: "E0", 9: "C0", 10: "A-1", 11: "G-1", 12: "F-1", 13: "E-1" };
              const trebleBelowMap = { 1: "C4", 2: "A3", 3: "F3", 4: "D3", 5: "B2", 6: "G2", 7: "E2", 8: "C2", 9: "A1", 10: "F1", 11: "D1", 12: "B0", 13: "G0" };

              let staffWidth = cols * 0.25;
              let staffStartX = midX - staffWidth / 2;
              let staffEndX = midX + staffWidth / 2;

              overlayCtx.lineWidth = 2.5;
              overlayCtx.strokeStyle = "rgba(255, 102, 0, 0.9)"; // Neon Orange

              closestStaff.lines.forEach(lineY => {
                let yStart = lineY + (staffStartX - midX) * tanVal;
                let yEnd = lineY + (staffEndX - midX) * tanVal;

                overlayCtx.beginPath();
                overlayCtx.moveTo(staffStartX, yStart);
                overlayCtx.lineTo(staffEndX, yEnd);
                overlayCtx.stroke();
              });

              let staffWidthLocal = cols * 0.25;
              let ledgerWidth = staffWidthLocal / 5;
              let ledgerStartX = midX - ledgerWidth / 2;
              let ledgerEndX = midX + ledgerWidth / 2;

              overlayCtx.strokeStyle = "rgba(255, 102, 0, 0.9)";
              overlayCtx.lineWidth = 2;
              overlayCtx.textBaseline = "middle";

              // Font sizes: Bass (+10% -> 16px), Treble (+20% -> 18px)
              let bassFont = "16px Arial, sans-serif";
              let trebleFont = "18px Arial, sans-serif";

              // Robust helper function with explicit parameters to prevent scoping/closure errors
              const renderSplitLabel = (ctx, lineStr, bNote, tNote, xPos, yPos, isRightAlign) => {
                ctx.fillStyle = "rgba(255, 102, 0, 0.9)";

                if (isRightAlign) {
                  ctx.font = trebleFont;
                  ctx.textAlign = "right";
                  ctx.fillText(`𝄞${tNote}`, xPos, yPos);

                  let trebleWidth = ctx.measureText(`𝄞${tNote}`).width;

                  ctx.font = bassFont;
                  ctx.fillText(`𝄢${bNote} ${lineStr}`, xPos - trebleWidth - 8, yPos);
                } else {
                  ctx.font = bassFont;
                  ctx.textAlign = "left";
                  ctx.fillText(`${lineStr}𝄢${bNote}`, xPos, yPos);

                  let bassWidth = ctx.measureText(`${lineStr}𝄢${bNote}`).width;

                  ctx.font = trebleFont;
                  ctx.fillText(` 𝄞${tNote}`, xPos + bassWidth, yPos);
                }
              };

              // Render Ledger Lines Above Staff (+1 to +10)
              let maxAboveLines = 10;
              for (let lineVal = 1; lineVal <= maxAboveLines; lineVal++) {
                let ledgerY = topLineY - (lineVal * closestStaff.spacing);
                let lStart = ledgerY + (ledgerStartX - midX) * tanVal;
                let lEnd = ledgerY + (ledgerEndX - midX) * tanVal;

                overlayCtx.beginPath();
                overlayCtx.moveTo(ledgerStartX, lStart);
                overlayCtx.lineTo(ledgerEndX, lEnd);
                overlayCtx.stroke();

                let bNote = bassAboveMap[lineVal] || "";
                let tNote = trebleAboveMap[lineVal] || "";
                let lineStr = `+${lineVal}`;

                if (lineVal % 2 === 0) {
                  renderSplitLabel(overlayCtx, lineStr, bNote, tNote, ledgerStartX - 6, lEnd, true);
                } else {
                  renderSplitLabel(overlayCtx, lineStr, bNote, tNote, ledgerEndX + 6, lEnd, false);
                }
              }

              // Render Ledger Lines Below Staff (-1 to -13)
              let maxBelowLines = 13;
              for (let lineVal = 1; lineVal <= maxBelowLines; lineVal++) {
                let ledgerY = bottomLineY + (lineVal * closestStaff.spacing);
                let lStart = ledgerY + (ledgerStartX - midX) * tanVal;
                let lEnd = ledgerY + (ledgerEndX - midX) * tanVal;

                overlayCtx.beginPath();
                overlayCtx.moveTo(ledgerStartX, lStart);
                overlayCtx.lineTo(ledgerEndX, lEnd);
                overlayCtx.stroke();

                let bNote = bassBelowMap[lineVal] || "";
                let tNote = trebleBelowMap[lineVal] || "";
                let lineStr = `-${lineVal}`;

                if (lineVal % 2 === 0) {
                  renderSplitLabel(overlayCtx, lineStr, bNote, tNote, ledgerStartX - 6, lEnd, true);
                } else {
                  renderSplitLabel(overlayCtx, lineStr, bNote, tNote, ledgerEndX + 6, lEnd, false);
                }
              }
            }
          }
        }

        src.delete();
        fullGray.delete();
        gray.delete();
        binaryRoi.delete();
      } catch (err) {
        console.error("OpenCV frame processing error:", err);
      }
    }
  }, 150);
}
