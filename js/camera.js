/**
 * Ledger Notes App - Camera & OpenCV Analysis Module
 *
 * Unified Staff Mode:
 * - Reference cross centered at rows * 0.5 (middle staff line).
 * - Slant-stack orientation and line detection.
 * - Ledger lines from -13 to +10 with staggered Bass Clef (even/left) and Treble Clef (odd/right) note naming.
 * - Center line text labels ("Bass Clef Notes" / "Treble Clef Notes") with boundary protection.
 * - Styled with High-Vis Neon Orange.
 */

const show_histogram = false;
const show_slant = false;
const display_bw = false;

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
                facingMode: {exact: "environment"},
                advanced: [{stabilization: true}]
            }
        });
    } catch (err) {
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({video: true});
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
    if (e.target.tagName === "BUTTON") return;
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
        if (bestProfile[y] > bestProfile[y - 1] && bestProfile[y] > bestProfile[y - 2] &&
            bestProfile[y] >= bestProfile[y + 1] && bestProfile[y] >= bestProfile[y + 2] &&
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
            staves.push({lines: group, spacing: avgD, angle: bestAngle});
            i += 4;
        }
    }

    return {staves, profile: bestProfile, bestAngle};
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

                let {staves, profile, bestAngle} = detectStavesSlantStack(binaryRoi, binaryRoi.cols, binaryRoi.rows);

                let roundedSteps = 0;

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

                        let rawClosestStaff = staves.reduce((prev, curr) =>
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
                        let closestStaff = {
                            lines: smoothedStaffLines,
                            spacing: rawClosestStaff.spacing,
                            angle: rawClosestStaff.angle
                        };

                        let topLineY = closestStaff.lines[0];
                        let bottomLineY = closestStaff.lines[4];

                        // Note mapping dictionaries for ledger lines:
                        const bassEvenAbove = {2: "E", 4: "B", 6: "F", 8: "C", 10: "G"};
                        const bassEvenBelow = {2: "C", 4: "F", 6: "B", 8: "E", 10: "A", 12: "D"};
                        const trebleOddAbove = {1: "A", 3: "E", 5: "B", 7: "F", 9: "C"};
                        const trebleOddBelow = {1: "C", 3: "F", 5: "B", 7: "E", 9: "A", 11: "D", 13: "G"};

                        overlayCtx.save();
                        overlayCtx.beginPath();
                        overlayCtx.rect(bandStart, yOffset, bandWidth, rows);
                        overlayCtx.clip();

                        overlayCtx.lineWidth = 2.5;
                        overlayCtx.strokeStyle = "rgba(255, 102, 0, 0.9)"; // Neon Orange

                        let staffWidth = cols * 0.25;
                        let staffStartX = midX - staffWidth / 2;
                        let staffEndX = midX + staffWidth / 2;

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

                        overlayCtx.strokeStyle = "rgba(255, 102, 0, 0.9)"; // Neon Orange
                        overlayCtx.lineWidth = 2;
                        overlayCtx.font = "bold 13px Arial, sans-serif";
                        overlayCtx.textBaseline = "middle";

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

                            if (lineVal % 2 === 0) {
                                let noteName = bassEvenAbove[lineVal] || "";
                                let labelText = `+${lineVal} ${noteName}`;
                                overlayCtx.textAlign = "right";
                                overlayCtx.fillStyle = "rgba(255, 102, 0, 0.9)";
                                overlayCtx.fillText(labelText, ledgerStartX - 6, lEnd);
                            } else {
                                let noteName = trebleOddAbove[lineVal] || "";
                                let labelText = `+${lineVal} ${noteName}`;
                                overlayCtx.textAlign = "left";
                                overlayCtx.fillStyle = "rgba(255, 102, 0, 0.9)";
                                overlayCtx.fillText(labelText, ledgerEndX + 6, lEnd);
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

                            if (lineVal % 2 === 0) {
                                let noteName = bassEvenBelow[lineVal] || "";
                                let labelText = `-${lineVal} ${noteName}`;
                                overlayCtx.textAlign = "right";
                                overlayCtx.fillStyle = "rgba(255, 102, 0, 0.9)";
                                overlayCtx.fillText(labelText, ledgerStartX - 6, lEnd);
                            } else {
                                let noteName = trebleOddBelow[lineVal] || "";
                                let labelText = `-${lineVal} ${noteName}`;
                                overlayCtx.textAlign = "left";
                                overlayCtx.fillStyle = "rgba(255, 102, 0, 0.9)";
                                overlayCtx.fillText(labelText, ledgerEndX + 6, lEnd);
                            }
                        }
                        overlayCtx.restore();

                        // Render Central Staff Line Labels ("Bass Clef Notes" / "Treble Clef Notes")
                        // Font size 26px (twice as large as ledger note numbers at 13px)
                        overlayCtx.font = "bold 26px Arial, sans-serif";
                        overlayCtx.textBaseline = "middle";
                        overlayCtx.fillStyle = "rgba(255, 102, 0, 0.9)"; // Neon Orange

                        // Left side: Bass Clef Notes (safely outside staffStartX)
                        overlayCtx.textAlign = "right";
                        overlayCtx.fillText("Bass Clef Notes", staffStartX - 12, centerY);

                        // Right side: Treble Clef Notes (safely outside staffEndX to prevent line collision)
                        overlayCtx.textAlign = "left";
                        overlayCtx.fillText("Treble Clef Notes", staffEndX + 12, centerY);

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
