export const SURFACE_Y = 0;
export const SHALLOWS_FLOOR = -22;
export const KELP_FLOOR = -64;
export const WORLD_SEED = 1337;

export const O2_MAX = 45;
export const SWIM_SPEED = 6.4;
export const DASH_SPEED = 11.2;
export const VERTICAL_SPEED = 5.4;

export const SHALLOWS_FOG = 0x1a888c;
export const KELP_FOG = 0x1a6c2c;
export const SHALLOWS_ABSORB = [0.04, 0.011, 0.013];
export const KELP_ABSORB = [0.044, 0.014, 0.040];

export const SUN_DIR = [-0.34, 0.88, 0.3];

export const SHOTS = {
  shallows: {
    position: [7.6, -19.05, 16.6],
    target: [1.2, -13.7, -6.1],
    hideHud: true,
  },
  kelp: {
    position: [170, -31.5, 14],
    target: [190, -16, -6],
    hideHud: false,
  },
  surface: {
    position: [6.2, -5.4, 15.2],
    target: [5.4, 3.2, 1.6],
    hideHud: true,
  },
  sky: {
    position: [-48, 3.05, -58],
    target: [-102, 18, -132],
    hideHud: true,
  },
  demo: {
    position: [8.0, -7.6, 16.4],
    target: [1.8, -13.6, -2.4],
    hideHud: false,
  },
  grassy: {
    position: [82, -11.5, 152],
    target: [92, -18, 182],
    hideHud: true,
  },
  mushroom: {
    position: [198, -22, -148],
    target: [236, -18, -188],
    hideHud: true,
  },
  bulb: {
    position: [-148, -20, 142],
    target: [-178, -26, 178],
    hideHud: true,
  },
  crimson: {
    position: [6, -32, -168],
    target: [10, -42, -214],
    hideHud: true,
  },
  jelly: {
    position: [16, -168, 88],
    target: [118, -182, 8],
    hideHud: true,
  },
  reef: {
    position: [-176, -72, 8],
    target: [-212, -84, -30],
    hideHud: true,
  },
  base: {
    position: [78, -8.4, 28],
    target: [58, -16.2, 2.2],
    hideHud: true,
  },
  basein: {
    position: [62.4, -15.4, 2.1],
    target: [78, -18.2, 10],
    hideHud: true,
  },
};
