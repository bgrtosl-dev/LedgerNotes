window.addEventListener("load", function () {
  const VF = Vex.Flow;
  let clef = "treble";
  let selectedLetter = "C";
  window.clef = clef;

  /* PIANO: A0 - C8 */
  const piano = [];
  const natural = [ "C", "D", "E", "F", "G", "A", "B" ];
  window.natural = natural;

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
  window.pitchPosition = pitchPosition;

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

  /* POPULATE NUMBER SELECTOR (-6 to +6 with "ledger" replacing 0) */
  function initRangeSelector() {
    const rangeSelect = document.getElementById("rangeSelect");
    if (!rangeSelect) return;
    rangeSelect.innerHTML = "";
    for (let i = 6; i >= -6; i--) {
      let opt = document.createElement("option");
      opt.value = i;
      if (i === 0) {
        opt.text = "ledger";
        opt.selected = true; // Default to "ledger"
      } else {
        opt.text = (i > 0 ? "+" + i : i);
      }
      rangeSelect.appendChild(opt);
    }
  }

  /* DRAW (Stave X at 30, Y moved up to 130) */
  function draw() {
    const score = document.getElementById("score");
    if (!score) { return; }
    score.innerHTML = "";
    const renderer = new VF.Renderer( score, VF.Renderer.Backends.SVG );
    renderer.resize( 320, 380 );
    const context = renderer.getContext();

    const stave = new VF.Stave( 30, 130, 180 );
    stave.addClef(clef);
    stave.setContext(context);
    stave.draw();

    const notes = piano.filter( n => n.letter === selectedLetter );
    const keys = notes.map(function (n) {
      return ( n.letter.toLowerCase() + "/" + n.octave );
    });

    if (keys.length === 0) return;

    const chord = new VF.StaveNote({ clef: clef, keys: keys, duration: "w" });
    const voice = new VF.Voice({ num_beats: 4, beat_value: 4 });
    voice.addTickables([ chord ]);
    new VF.Formatter().joinVoices([voice]).format( [voice], 80 );
    voice.draw( context, stave );

    drawLabels( chord, notes );
  }
  window.draw = draw;

  /* LABELS */
  function drawLabels(chord, notes) {
    const scoreEl = document.getElementById("score");
    const svg = scoreEl ? scoreEl.querySelector( "svg" ) : null;
    if (!svg) { return; }
    const ys = chord.getYs();
    let noteX = 0;
    if ( typeof chord.getAbsoluteX === "function" ) {
      noteX = chord.getAbsoluteX();
    }
    const labelX = noteX + 22;

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

    const rangeSelect = document.getElementById("rangeSelect");
    if (rangeSelect) rangeSelect.value = "0";

    draw();
  }

  /* CLEF TOGGLE LOGIC */
  const clefBtn = document.getElementById("clefSelectBtn");

  if (clefBtn) {
    clefBtn.addEventListener("click", () => {
      clef = (clef === "treble") ? "bass" : "treble";
      window.clef = clef;
      clefBtn.textContent = (clef === "treble") ? "𝄞" : "𝄢";

      const rangeSelect = document.getElementById("rangeSelect");
      if (rangeSelect) rangeSelect.value = "0";

      draw();
    });
  }

  const rangeSelect = document.getElementById("rangeSelect");
  if (rangeSelect) {
    rangeSelect.addEventListener("change", function () {
      if (this.value === "") return;
      const n = parseInt(this.value);
      let targetPitch;

      if (clef === "treble") {
        if (n > 0) {
          targetPitch = 40 + (n - 1) * 2;
        } else if (n < 0) {
          targetPitch = 28 + (n + 1) * 2;
        } else {
          targetPitch = 30;
        }
      } else {
        if (n > 0) {
          targetPitch = 28 + (n - 1) * 2;
        } else if (n < 0) {
          targetPitch = 16 + (n + 1) * 2;
        } else {
          targetPitch = 18;
        }
      }

      let letterIndexVal = ((targetPitch % 7) + 7) % 7;
      selectedLetter = natural[letterIndexVal];

      const noteSelect = document.getElementById("noteSelect");
      if (noteSelect) noteSelect.value = selectedLetter;
      draw();
    });
  }

  const noteSelect = document.getElementById("noteSelect");
  if (noteSelect) {
    noteSelect.addEventListener("change", function () {
      selectedLetter = this.value;

      const rangeSelect = document.getElementById("rangeSelect");
      if (rangeSelect) rangeSelect.value = "0";

      draw();
    });
  }

  document.getElementById("btnUp2").addEventListener("click", () => shiftNote(2));
  document.getElementById("btnUp1").addEventListener("click", () => shiftNote(1));
  document.getElementById("btnDown1").addEventListener("click", () => shiftNote(-1));
  document.getElementById("btnDown2").addEventListener("click", () => shiftNote(-2));

  /* Help Modal Events */
  const helpBtn = document.getElementById("helpBtn");
  const helpModal = document.getElementById("help-modal");
  const closeHelpBtn = document.getElementById("closeHelpBtn");
  if (helpBtn && helpModal) {
    helpBtn.addEventListener("click", () => {
      helpModal.style.display = "flex";
    });
    if (closeHelpBtn) {
      closeHelpBtn.addEventListener("click", () => {
        helpModal.style.display = "none";
      });
    }
    helpModal.addEventListener("click", (e) => {
      if (e.target === helpModal) {
        helpModal.style.display = "none";
      }
    });
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

  /* INITIALIZATION */
  initRangeSelector();
  const rangeSelectEl = document.getElementById("rangeSelect");
  if (rangeSelectEl) rangeSelectEl.value = "0";

  const noteSelectEl = document.getElementById("noteSelect");
  if (noteSelectEl) noteSelectEl.value = selectedLetter;
  draw();
});

/* SERVICE WORKER */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("./service-worker.js");
  });
}
