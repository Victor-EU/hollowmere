import type { FlightInput } from '../flight/flight';
import { clamp } from '../world/math';

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'KeyQ', 'KeyC']);

export interface Input {
  /** Fresh movement state for this frame; look deltas accumulate until the flight consumes them. */
  read(): FlightInput;
  /** Set by dev tools to take a pointer press or wheel turn before it becomes a look drag or zoom. */
  hooks: InputHooks;
}

export interface InputHooks {
  claimPointer?(e: PointerEvent): boolean;
  claimWheel?(e: WheelEvent): boolean;
}

/** Keys typed into a form field belong to the field. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

export interface InputHandlers {
  toggleAuto(): void;
  toggleSound(): void;
  toggleHelp(): void;
  /** Any pointer or key gesture, for starting audio. */
  gesture(): void;
}

/** Keyboard, mouse drag, wheel zoom, and on touch screens a floating left stick, right-side look and ▲ ▼ buttons. */
export function makeInput(canvas: HTMLCanvasElement, isTouch: boolean, on: InputHandlers): Input {
  const keys = new Set<string>();
  const state: FlightInput = { forward: 0, strafe: 0, rise: 0, boost: false, lookDX: 0, lookDY: 0, zoom: 1 };
  const stick = { x: 0, y: 0 };
  let up = 0;
  const hooks: InputHooks = {};

  addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    const target = e.target as Element | null;
    if (target?.closest?.('button') && (e.code === 'Space' || e.code === 'Enter')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (MOVE_KEYS.has(e.code)) {
      keys.add(e.code);
      e.preventDefault();
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.add('Shift');
    if (e.repeat) return;
    if (e.code === 'KeyF') on.toggleAuto();
    if (e.code === 'KeyM') on.toggleSound();
    if (e.code === 'KeyH') on.toggleHelp();
    // After the toggles, so pressing M doesn't both resume and then mute.
    on.gesture();
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code.startsWith('Shift')) keys.delete('Shift');
  });
  addEventListener('blur', () => keys.clear());

  let drag: { id: number; x: number; y: number } | null = null;
  let stickId: number | null = null;
  let stickOrigin = { x: 0, y: 0 };
  const stickEl = document.querySelector<HTMLElement>('#stick')!;
  const knob = document.querySelector<HTMLElement>('#stickKnob')!;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus({ preventScroll: true });
    on.gesture();
    if (hooks.claimPointer?.(e)) return;
    if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.45 && e.clientY > innerHeight * 0.4 && stickId === null) {
      stickId = e.pointerId;
      const r = stickEl.getBoundingClientRect();
      stickEl.style.left = `${e.clientX - r.width / 2}px`;
      stickEl.style.top = `${e.clientY - r.height / 2}px`;
      stickEl.style.bottom = 'auto';
      stickOrigin = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (drag) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) {
      const dx = e.clientX - stickOrigin.x;
      const dy = e.clientY - stickOrigin.y;
      const l = Math.hypot(dx, dy);
      const m = Math.min(l, 44);
      const nx = l ? (dx / l) * m : 0;
      const ny = l ? (dy / l) * m : 0;
      knob.style.transform = `translate(${nx}px,${ny}px)`;
      stick.x = nx / 44;
      stick.y = -ny / 44;
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    state.lookDX += e.clientX - drag.x;
    state.lookDY += e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const endPointer = (e: PointerEvent) => {
    if (e.pointerId === stickId) {
      stickId = null;
      stick.x = stick.y = 0;
      knob.style.transform = '';
      stickEl.style.left = stickEl.style.top = stickEl.style.bottom = '';
      return;
    }
    if (drag && e.pointerId === drag.id) {
      drag = null;
      canvas.classList.remove('dragging');
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (hooks.claimWheel?.(e)) return;
      state.zoom = clamp(state.zoom * Math.exp(e.deltaY * 0.0012), 0.4, 2.4);
    },
    { passive: false },
  );

  if (isTouch) {
    stickEl.hidden = false;
    document.querySelector<HTMLElement>('#altbtns')!.hidden = false;
    const hold = (el: HTMLElement, v: number) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        on.gesture();
        up = v;
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
        el.addEventListener(ev, () => {
          if (up === v) up = 0;
        });
      }
    };
    hold(document.querySelector<HTMLElement>('#btnUp')!, 1);
    hold(document.querySelector<HTMLElement>('#btnDown')!, -1);
    // Two-finger pinch zooms the camera.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size !== 2 || stickId !== null) return;
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) state.zoom = clamp(state.zoom * (pinch / d), 0.4, 2.4);
      pinch = d;
    });
    const lift = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      pinch = 0;
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
  }

  const k = (code: string) => (keys.has(code) ? 1 : 0);
  return {
    hooks,
    read() {
      state.forward = (k('KeyW') || k('ArrowUp')) - (k('KeyS') || k('ArrowDown')) + stick.y;
      state.strafe = (k('KeyD') || k('ArrowRight')) - (k('KeyA') || k('ArrowLeft')) + stick.x;
      state.rise = (k('Space') || k('KeyE')) - (k('KeyQ') || k('KeyC')) + up;
      state.boost = keys.has('Shift');
      return state;
    },
  };
}
