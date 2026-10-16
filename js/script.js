window.addEventListener("load", function () {
const VF = Vex.Flow;
let clef = "treble";
let selectedLetter = "C";

/* PIANO: A0 - C8 */
const piano = [];
const natural = [ "C", "D", "E", "F", "G", "A", "B" ];
for (let octave = 0; octave <= 8; octave++) {
  for (const letter of natural) {
    if ( octave === 0 && letter !== "A" && letter !== "B" ) { continue; }
    if ( octave === 8 && letter !== "C" ) { continue; }
    piano.push({ letter, octave });
  }
}

/* DIATONIC POSITION */
const letterIndex = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
function pitchPosition(letter, octave) {
  return octave * 7 + letterIndex[letter];
}

/* LEDGER POSITION */
function ledgerLineCount(letter, octave) {
  const p = pitchPosition(letter, octave);
  let bottom;
  let top;
  if (clef === "treble") {
    bottom = pitchPosition("E", 4);
    top = pitchPosition("F", 5);
  } else {
    bottom = pitchPosition("G", 2);
    top = pitchPosition("A", 3);
  }
  if (p >= bottom && p <= top) { return 0; }
  if (p > top) { return (p - top) / 2; }
  return -(bottom - p) / 2;
}

/* DRAW */
function draw() {
  const score = document.getElementById("score");
  score.innerHTML = "";
  const renderer = new VF.Renderer( score, VF.Renderer.Backends.SVG );
  renderer.resize( 600, 380 );
  const context = renderer.getContext();

  const stave = new VF.Stave( 50, 125, 125 );
  stave.addClef(clef);
  stave.setContext(context);
  stave.draw();

  const notes = piano.filter( n => n.letter === selectedLetter );
  const keys = notes.map(function (n) {
    return ( n.letter.toLowerCase() + "/" + n.octave );
  });

  const chord = new VF.StaveNote({ clef: clef, keys: keys, duration: "w" });
  const voice = new VF.Voice({ numbeats: 4, beatvalue: 4 });
  voice.addTickables([ chord ]);
  new VF.Formatter().joinVoices([voice]).format( [voice], 80 );
  voice.draw( context, stave );

  drawLabels( chord, notes );
}

/* LABELS */
function drawLabels(chord, notes) {
  const svg = document.querySelector( "#score svg" );
  if (!svg) { return; }
  const ys = chord.getYs();
  let noteX = 0;
  if ( typeof chord.getAbsoluteX === "function" ) {
    noteX = chord.getAbsoluteX();
  }
  const labelX = noteX + 25;
  notes.forEach(function (note, index) {
    const y = ys[index];
    const count = ledgerLineCount( note.letter, note.octave );
    let countText = "";
    if (count !== 0) {
      const formattedCount = Number.isInteger(count) ? String(count) : count.toFixed(1);
      const sign = count > 0 ? "+" : "";
      countText = "/" + sign + formattedCount;
    }
    const label = note.letter + note.octave + countText;

    const text = document.createElementNS( "http://www.w3.org/2000/svg", "text" );
    text.setAttribute( "x", labelX );
    text.setAttribute( "y", y + 4 );
    text.setAttribute( "font-family", "Arial, sans-serif" );
    text.setAttribute( "font-size", "11" );
    text.setAttribute( "fill", "#333" );
    text.textContent = label;
    svg.appendChild(text);
  });
}

/* NOTE SHIFT HELPER */
function shiftNote(steps) {
  const currentIndex = natural.indexOf(selectedLetter);
  let newIndex = (currentIndex + steps) % natural.length;
  if (newIndex < 0) {
    newIndex += natural.length;
  }
  selectedLetter = natural[newIndex];
  document.getElementById("noteSelect").value = selectedLetter;
  draw();
}

/* CONTROLS */
const clefBtn = document.getElementById("clefToggleBtn");
clefBtn.addEventListener("click", function () {
  const currentIndex = natural.indexOf(selectedLetter);
  let newIndex;

  if (clef === "treble") {
    clef = "bass";
    this.textContent = "𝄢 Bass";
    newIndex = (currentIndex + 2) % natural.length;
  } else {
    clef = "treble";
    this.textContent = "𝄞 Treble";
    newIndex = (currentIndex - 2 + natural.length) % natural.length;
  }

  selectedLetter = natural[newIndex];
  document.getElementById("noteSelect").value = selectedLetter;
  draw();
});

document.getElementById("noteSelect").addEventListener("change", function () {
  selectedLetter = this.value;
  draw();
});

document.getElementById("btnUp2").addEventListener("click", () => shiftNote(2));
document.getElementById("btnUp1").addEventListener("click", () => shiftNote(1));
document.getElementById("btnDown1").addEventListener("click", () => shiftNote(-1));
document.getElementById("btnDown2").addEventListener("click", () => shiftNote(-2));

/* CAMERA TOOL LOGIC & TOUCH-TO-SELECT INTERACTION */
let mediaStream = null;
let processingInterval = null;
let latestAnalysisData = null;

const cameraOverlay = document.getElementById("camera-overlay");
const cameraVideo = document.getElementById("camera-video");
const cameraCanvas = document.getElementById("camera-canvas");
const overlayCanvas = document.getElementById("camera-overlay-canvas");
const liveOffsetDisplay = document.getElementById("live-offset-display");

document.getElementById("cameraBtn").addEventListener("click", async () => {
  if (!window.openCVReady || typeof cv === "undefined") {
    alert("OpenCV is still loading or failed to initialize. Please wait a moment and try again.");
    return;
  }
  cameraOverlay.style.display = "flex";
  latestAnalysisData = null;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: "environment" } }
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

/* Touch anywhere on overlay to select current note value and exit */
cameraOverlay.addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") return;
  if (latestAnalysisData) {
    const { halfStepOffset } = latestAnalysisData;
    const basePitch = (clef === "treble") ? pitchPosition("E", 4) : pitchPosition("G", 2);
    const targetPitch = basePitch + Math.round(halfStepOffset);
    const letterIndexVal = ((targetPitch % 7) + 7) % 7;
    selectedLetter = natural[letterIndexVal];

    document.getElementById("noteSelect").value = selectedLetter;
    draw();
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
  cameraOverlay.style.display = "none";
}

function detectStavesSlantStack(gray, cols, rows) {
  let bandStart = Math.floor(cols * 0.375);
  let bandEnd = Math.floor(cols * 0.625);
  let bandWidth = bandEnd - bandStart;

  let roi = gray.roi(new cv.Rect(bandStart, 0, bandWidth, rows));

  let bestAngle = 0;
  let maxVariance = -1;
  let bestProfile = new Array(rows).fill(0);

  // Reduced angle scan range from -5 to +5 degrees in 1-degree steps
  for (let angle = -5; angle <= 5; angle += 1) {
    let center = new cv.Point(roi.cols / 2, roi.rows / 2);
    let rotMat = cv.getRotationMatrix2D(center, angle, 1.0);
    let rotated = new cv.Mat();
    cv.warpAffine(roi, rotated, rotMat, roi.size(), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255));

    let profile = new Array(rows).fill(0);
    for (let y = 0; y < rows; y++) {
      let sum = 0;
      for (let x = 0; x < rotated.cols; x++) {
        sum += (255 - rotated.ucharAt(y, x));
      }
      profile[y] = sum / rotated.cols;
    }

    let mean = profile.reduce((a, b) => a + b, 0) / rows;
    let variance = profile.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rows;

    if (variance > maxVariance) {
      maxVariance = variance;
      bestAngle = angle;
      bestProfile = profile;
    }

    rotMat.delete();
    rotated.delete();
  }
  roi.delete();

  let minima = [];
  for (let y = 2; y < rows - 2; y++) {
    if (bestProfile[y] > bestProfile[y-1] && bestProfile[y] > bestProfile[y-2] && 
        bestProfile[y] >= bestProfile[y+1] && bestProfile[y] >= bestProfile[y+2] &&
        bestProfile[y] > (bestProfile.reduce((a,b)=>a+b,0)/rows)*1.2) {
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

    // Least-squares validation using your formula
    let d = avgD;
    let Emin = Math.pow(d - d1, 2) + Math.pow(d - d2, 2) + Math.pow(d - d3, 2) + Math.pow(d - d4, 2);
    let E0 = Math.pow(d1, 2) + Math.pow(d2, 2) + Math.pow(d3, 2) + Math.pow(d4, 2);
    let rho = E0 > 0 ? (E0 - Emin) / E0 : 0;

    if (avgD > 6 && avgD < 60 && rho > 0.8) {
      staves.push({ lines: group, spacing: avgD, angle: bestAngle });
      i += 4;
    }
  }

  return { staves, profile: bestProfile, bestAngle };
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
        let gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        let { staves, profile, bestAngle } = detectStavesSlantStack(gray, gray.cols, gray.rows);

        // Draw red filled projection profile waveform following estimated dip angle
        if (profile && profile.length > 0) {
          let maxVal = Math.max(...profile, 1);
          let graphWidth = gray.cols * 0.10;
          let graphCenterX = gray.cols * 0.5;
          let rad = bestAngle * Math.PI / 180;
          let tanVal = Math.tan(rad);

          overlayCtx.fillStyle = "rgba(255, 0, 0, 0.25)";
          overlayCtx.strokeStyle = "rgba(255, 0, 0, 0.8)";
          overlayCtx.lineWidth = 1.5;

          overlayCtx.beginPath();
          let startX = graphCenterX + (0 - gray.rows / 2) * tanVal;
          overlayCtx.moveTo(startX, 0);

          for (let y = 0; y < profile.length; y++) {
            let amplitude = (profile[y] / maxVal) * graphWidth;
            let baseY = y;
            let baseX = graphCenterX + (baseY - gray.rows / 2) * tanVal;
            let x = baseX + amplitude;
            overlayCtx.lineTo(x, baseY);
          }
          
          let endX = graphCenterX + (gray.rows - gray.rows / 2) * tanVal;
          overlayCtx.lineTo(endX, profile.length - 1);
          overlayCtx.closePath();
          overlayCtx.fill();
          overlayCtx.stroke();
        }

        // Find staff closest to screen center (red cross)
        if (staves.length > 0) {
          let centerY = gray.rows / 2;
          let closestStaff = staves.reduce((prev, curr) => 
            Math.abs(curr.lines[2] - centerY) < Math.abs(prev.lines[2] - centerY) ? curr : prev
          );

          overlayCtx.lineWidth = 2.5;
          overlayCtx.strokeStyle = "rgba(0, 255, 0, 0.9)";

          let rad = closestStaff.angle * Math.PI / 180;
          let tanVal = Math.tan(rad);
          let midX = gray.cols * 0.5;

          // Staff lines: 25% screen width centered
          let staffWidth = gray.cols * 0.25;
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

          // Calculate offset relative to bottom line (Line 4):
          // Positive if above staff, negative if below staff, rounded to closest half-integer
          let bottomLineY = closestStaff.lines[4];
          let topLineY = closestStaff.lines[0];
          let halfStepSize = closestStaff.spacing / 2;
          
          let rawOffset = (bottomLineY - centerY) / halfStepSize;
          let roundedHalfStep = Math.round(rawOffset * 2) / 2;

          latestAnalysisData = { halfStepOffset: roundedHalfStep };
          let signStr = roundedHalfStep > 0 ? "+" : "";
          liveOffsetDisplay.textContent = `Offset: ${signStr}${roundedHalfStep.toFixed(1)} steps`;

          // Ledger lines: 10% screen width centered, bright green
          if (centerY < topLineY || centerY > bottomLineY) {
            let ledgerWidth = gray.cols * 0.10;
            let ledgerStartX = midX - ledgerWidth / 2;
            let ledgerEndX = midX + ledgerWidth / 2;

            overlayCtx.strokeStyle = "rgba(0, 255, 0, 0.9)";
            overlayCtx.lineWidth = 2;

            if (centerY < topLineY) {
              // Draw ledger lines above top line
              let topOffsetSteps = Math.round((topLineY - centerY) / halfStepSize);
              for (let hs = 9; hs <= 8 + topOffsetSteps; hs += 2) {
                let ledgerY = topLineY - (hs - 8) * halfStepSize;
                let lStart = ledgerY + (ledgerStartX - midX) * tanVal;
                let lEnd = ledgerY + (ledgerEndX - midX) * tanVal;
                overlayCtx.beginPath();
                overlayCtx.moveTo(ledgerStartX, lStart);
                overlayCtx.lineTo(ledgerEndX, lEnd);
                overlayCtx.stroke();
              }
            } else if (centerY > bottomLineY) {
              // Draw ledger lines below bottom line
              let botOffsetSteps = Math.round((centerY - bottomLineY) / halfStepSize);
              for (let hs = 1; hs <= botOffsetSteps; hs += 2) {
                let ledgerY = bottomLineY + hs * halfStepSize;
                let lStart = ledgerY + (ledgerStartX - midX) * tanVal;
                let lEnd = ledgerY + (ledgerEndX - midX) * tanVal;
                overlayCtx.beginPath();
                overlayCtx.moveTo(ledgerStartX, lStart);
                overlayCtx.lineTo(ledgerEndX, lEnd);
                overlayCtx.stroke();
              }
            }
          }
        } else {
          liveOffsetDisplay.textContent = "Offset: --";
        }

        src.delete();
        gray.delete();
      } catch (err) {
        console.error("OpenCV frame processing error:", err);
      }
    }
  }, 150);
}

/* QR Modal events */
const qrBtn = document.getElementById("qr-btn");
const qrModal = document.getElementById("qr-modal");
if (qrBtn && qrModal) {
    qrBtn.addEventListener("click", () => {
        qrModal.style.display = "flex";
    });
    qrModal.addEventListener("click", (e) => {
        if (e.target === qrModal) {
            qrModal.style.display = "none";
        }
    });
}

/* INITIAL DRAW */
draw();
});

/* SERVICE WORKER */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("./service-worker.js");
  });
}
