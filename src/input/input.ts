// Unified keyboard + gamepad input for driving.
//
// Continuous controls (throttle/brake/horn) are polled via getters; discrete
// actions (reverse, camera, map, change line) fire callbacks on the rising
// edge so a single press triggers once.

export class InputManager {
  private readonly keys = new Set<string>();
  private prevButtons: boolean[] = [];

  onReverse?: () => void;
  onCameraToggle?: () => void;
  onMapToggle?: () => void;
  onPrevLine?: () => void;
  onNextLine?: () => void;

  constructor() {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) {
        if (k === "r") this.onReverse?.();
        else if (k === "c") this.onCameraToggle?.();
        else if (k === "m") this.onMapToggle?.();
        else if (k === "[") this.onPrevLine?.();
        else if (k === "]") this.onNextLine?.();
      }
      this.keys.add(k);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
  }

  private gamepad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p) return p;
    return null;
  }

  /** Poll the gamepad for edge-triggered buttons. Call once per frame. */
  update(): void {
    const pad = this.gamepad();
    if (!pad) return;
    const pressed = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => pressed[i] && !this.prevButtons[i];
    if (edge(1)) this.onReverse?.(); // B
    if (edge(3)) this.onCameraToggle?.(); // Y
    if (edge(8)) this.onMapToggle?.(); // Back/Select
    if (edge(4)) this.onPrevLine?.(); // LB
    if (edge(5)) this.onNextLine?.(); // RB
    this.prevButtons = pressed;
  }

  private buttonValue(index: number): number {
    const pad = this.gamepad();
    return pad ? (pad.buttons[index]?.value ?? 0) : 0;
  }

  get throttle(): number {
    const kb = this.keys.has("arrowup") || this.keys.has("w") ? 1 : 0;
    return Math.max(kb, this.buttonValue(7)); // RT
  }

  get brake(): number {
    const kb = this.keys.has("arrowdown") || this.keys.has("s") ? 1 : 0;
    return Math.max(kb, this.buttonValue(6)); // LT
  }

  get horn(): boolean {
    const kb = this.keys.has(" ") || this.keys.has("h");
    const pad = this.gamepad();
    return kb || (pad ? (pad.buttons[0]?.pressed ?? false) : false); // A
  }
}
