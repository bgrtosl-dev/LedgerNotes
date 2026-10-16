/**
 * Ledger Notes App - Main Application Logic
 */

// Global shared state and helpers
window.VF = Vex.Flow;
window.clef = "treble";
window.selectedLetter = "C";
window.natural = [ "C", "D", "E", "F", "G", "A", "B" ];

/* PIANO: A0 - C8 */
const piano = [];
for (let octave = 0; octave <= 8; octave++) {
  for (const letter of window.natural) {
    if ( octave === 0 && letter !== "A" && letter !== "B" ) { continue; }
    if ( octave === 8 && letter !== "C" ) { continue; }
    piano.push({ letter, octave });
  }
}

/* DIATONIC POSITION */
const letterIndex = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
window.pitchPosition = function(letter, octave) {
  return octave * 7 + letterIndex[letter];
};

/* LEDGER POSITION */
function ledgerLineCount(letter, octave) {
  const p = window.pitchPosition(letter, octave);
  let bottom;
  let top;
  if (window.clef === "treble") {
    bottom = window.pitchPosition("E", 4);
    top = window.pitchPosition("F", 5);
  } else {
    bottom = window.pitchPosition("G", 2);
    top = window.pitchPosition("A", 3);
  }
  if (p >= bottom && p <= top) { return 0; }
  if (p > top) { return (p - top) / 2; }
  return -(bottom - p) / 2;
}

/* DRAW */
window.draw = function() {
  const score = document.getElementById("score");
  score.innerHTML = "";
  const renderer = new window.VF.Renderer( score, window.VF.Renderer.Backends.SVG );
  renderer.resize( 600, 380 );
  const context = renderer.getContext();

  const stave = new window.VF.Stave( 50, 125, 125 );
  stave.addClef(window.clef);
  stave.setContext(context);
  stave.draw();

  const notes = piano.filter( n => n.letter === window.selectedLetter );
  const keys = notes.map(function (n) {
    return ( n.letter.toLowerCase() + "/" + n.octave );
  });

  const chord = new window.VF.StaveNote({ clef: window.clef, keys: keys, duration: "w" });
  const voice = new window.VF.Voice({ numbeats: 4, beatvalue: 4 });
  voice.addTickables([ chord ]);
  new window.VF.Formatter().joinVoices([voice]).format( [voice], 80 );
  voice.draw( context, stave );

  drawLabels( chord, notes );
};

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
  const currentIndex = window.natural.indexOf(window.selectedLetter);
  let newIndex = (currentIndex + steps) % window.natural.length;
  if (newIndex < 0) {
    newIndex += window.natural.length;
  }
  window.selectedLetter = window.natural[newIndex];
  document.getElementById("noteSelect").value = window.selectedLetter;
  window.draw();
}

window.addEventListener("load", function () {
  /* CONTROLS */
  const clefBtn = document.getElementById("clefToggleBtn");
  clefBtn.addEventListener("click", function () {
    const currentIndex = window.natural.indexOf(window.selectedLetter);
    let newIndex;

    if (window.clef === "treble") {
      window.clef = "bass";
      this.textContent = "𝄢 Bass";
      newIndex = (currentIndex + 2) % window.natural.length;
    } else {
      window.clef = "treble";
      this.textContent = "𝄞 Treble";
      newIndex = (currentIndex - 2 + window.natural.length) % window.natural.length;
    }

    window.selectedLetter = window.natural[newIndex];
    document.getElementById("noteSelect").value = window.selectedLetter;
    window.draw();
  });

  document.getElementById("noteSelect").addEventListener("change", function () {
    window.selectedLetter = this.value;
    window.draw();
  });

  document.getElementById("btnUp2").addEventListener("click", () => shiftNote(2));
  document.getElementById("btnUp1").addEventListener("click", () => shiftNote(1));
  document.getElementById("btnDown1").addEventListener("click", () => shiftNote(-1));
  document.getElementById("btnDown2").addEventListener("click", () => shiftNote(-2));

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
  window.draw();
});

/* SERVICE WORKER */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("./service-worker.js");
  });
}
