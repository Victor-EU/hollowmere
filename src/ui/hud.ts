import type { Flight } from '../flight/flight';

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
/** A status has to hold this long (ms) before a screen reader hears it, so flickers through thin walls stay quiet. */
const SETTLE = 1000;
/** The title placard fades this long (ms) after the controls are first touched (design doc §14). */
const PLACARD_FADE = 5000;

export interface Hud {
  update(flight: Flight, zoneLabel: string | null): void;
  setAuto(on: boolean): void;
  /** `waiting`: sound was on last visit and comes back with the first gesture. */
  setSound(on: boolean, waiting?: boolean): void;
  toggleHelp(): void;
  closeHelp(): void;
  /** Fade the loader out after the first frame. */
  ready(): void;
}

export function makeHud(isTouch: boolean, handlers: { toggleAuto(): void; toggleSound(): void }): Hud {
  const btnAuto = $<HTMLButtonElement>('#btnAuto');
  const btnSound = $<HTMLButtonElement>('#btnSound');
  const btnHelp = $<HTMLButtonElement>('#btnHelp');
  const help = $('#help');
  const mode = $('#mode');
  const modeText = $('#modeText');
  const modeSub = $('#modeSub');
  const announcer = $('#announce');
  const placard = $('#placard');
  btnAuto.addEventListener('click', handlers.toggleAuto);
  btnSound.addEventListener('click', handlers.toggleSound);
  btnHelp.addEventListener('click', () => toggleHelp());
  if (isTouch) document.body.classList.add('touch');

  function toggleHelp() {
    help.hidden = !help.hidden;
    btnHelp.setAttribute('aria-expanded', String(!help.hidden));
  }

  // The live region hears the pill's changes, but not its countdown, and only once they've settled.
  let said = '';
  let pending = '';
  let pendingSince = 0;
  const announce = (text: string) => {
    const now = performance.now();
    if (text !== pending) {
      pending = text;
      pendingSince = now;
    } else if (text !== said && now - pendingSince >= SETTLE) {
      said = text;
      announcer.textContent = text;
    }
  };

  let lastKey = '';
  let fading = false;
  return {
    update(flight, zoneLabel) {
      if (flight.touched && !fading) {
        fading = true;
        setTimeout(() => placard.classList.add('faded'), PLACARD_FADE);
      }
      const A = flight.auto;
      let key: string;
      let title: string;
      let sub: string;
      /** What a screen reader hears: the pill without the countdown or the hints the canvas description already gives. */
      let spoken: string;
      if (A.enabled && !A.override) {
        key = 'auto';
        title = 'Autofly';
        sub = !flight.touched
          ? isTouch
            ? 'Drag to look · left stick to take over'
            : 'Drag to look around · WASD to take over'
          : (zoneLabel ?? 'Following the lantern route');
        spoken = flight.touched ? `Autofly, ${sub}` : 'Autofly';
      } else if (A.enabled) {
        const s = flight.returnsIn ?? 0;
        key = `wait${s}`;
        title = 'Free flight';
        sub = `Autofly returns in ${s} s`;
        spoken = zoneLabel ? `Free flight, ${zoneLabel}` : 'Free flight';
      } else {
        key = 'free';
        title = 'Free flight';
        sub = zoneLabel ?? 'Autofly is off';
        spoken = `Free flight, ${sub}`;
      }
      if (flight.where) {
        sub = flight.where === 'hall' ? 'Inside the great hall' : 'Passing through stone';
        spoken = `${title}, ${sub}`;
      }
      announce(spoken);
      key += `|${sub}`;
      if (key === lastKey) return;
      lastKey = key;
      mode.classList.toggle('free', !(A.enabled && !A.override));
      modeText.textContent = title;
      modeSub.textContent = sub;
    },
    setAuto(on) {
      btnAuto.setAttribute('aria-pressed', String(on));
    },
    setSound(on, waiting = false) {
      btnSound.setAttribute('aria-pressed', String(on));
      btnSound.toggleAttribute('data-waiting', waiting && !on);
      btnSound.title = waiting && !on ? 'Sound was on last time; it comes back with your first click or key' : '';
    },
    toggleHelp,
    closeHelp() {
      if (!help.hidden) toggleHelp();
    },
    ready() {
      const loader = $('#loader');
      setTimeout(() => loader.classList.add('gone'), 120);
      setTimeout(() => (loader.hidden = true), 1400);
    },
  };
}
