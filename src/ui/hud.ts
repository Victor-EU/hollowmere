import type { Flight } from '../flight/flight';

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;

export interface Hud {
  update(flight: Flight, zoneLabel: string | null): void;
  setAuto(on: boolean): void;
  setSound(on: boolean): void;
  toggleHelp(): void;
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
  btnAuto.addEventListener('click', handlers.toggleAuto);
  btnSound.addEventListener('click', handlers.toggleSound);
  btnHelp.addEventListener('click', () => toggleHelp());
  if (isTouch) document.body.classList.add('touch');

  function toggleHelp() {
    help.hidden = !help.hidden;
    btnHelp.setAttribute('aria-expanded', String(!help.hidden));
  }

  let lastKey = '';
  return {
    update(flight, zoneLabel) {
      const A = flight.auto;
      let key: string;
      let title: string;
      let sub: string;
      if (A.enabled && !A.override) {
        key = 'auto';
        title = 'Autofly';
        sub = !flight.touched
          ? isTouch
            ? 'Drag to look · left stick to take over'
            : 'Drag to look around · WASD to take over'
          : (zoneLabel ?? 'Following the lantern route');
      } else if (A.enabled) {
        const s = flight.returnsIn ?? 0;
        key = `wait${s}`;
        title = 'Free flight';
        sub = `Autofly returns in ${s} s`;
      } else {
        key = 'free';
        title = 'Free flight';
        sub = zoneLabel ?? 'Autofly is off';
      }
      if (flight.where) {
        sub = flight.where === 'hall' ? 'Inside the great hall' : 'Passing through stone';
      }
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
    setSound(on) {
      btnSound.setAttribute('aria-pressed', String(on));
    },
    toggleHelp,
    ready() {
      const loader = $('#loader');
      setTimeout(() => loader.classList.add('gone'), 120);
      setTimeout(() => (loader.hidden = true), 1400);
    },
  };
}
