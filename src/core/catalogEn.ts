import type { Catalog, Lang } from '../rules/types';

export const EN_CATALOG = {
  rockets: {
    falcon_9: {
      name: 'Falcon 9 Block 5',
      stages: {
        f9_s1: 'Stage 1: 9x Merlin 1D',
        f9_s2: 'Stage 2: Merlin Vac + Fairing',
      },
    },
    atlas_v: {
      name: 'Atlas V 551 (NASA Science)',
      stages: {
        av_srb: '5x AJ-60A SRB Boosters',
        av_core: 'RD-180 Core Stage',
        av_centaur: 'Centaur RL10C + Transfer',
      },
    },
    sls_block1: {
      name: 'SLS Block 1 (Artemis)',
      stages: {
        sls_srb: '2x 5-Segment SRB Boosters',
        sls_core: 'Core Stage 4x RS-25',
        sls_icps: 'ICPS RL10B-2 + Transfer',
      },
    },
    saturn_v: {
      name: 'Saturn V (Apollo)',
      stages: {
        sv_s1c: 'S-IC Stage (5x F-1)',
        sv_s2: 'S-II Stage (5x J-2)',
        sv_s4b: 'S-IVB Stage (J-2) + Transfer',
      },
    },
  } as Record<string, { name: string; stages: Record<string, string> }>,

  modules: {
    apollo_lm: 'Apollo Lunar Module (LM)',
    artemis_hls: 'Artemis HLS / Orion Lander',
    mars_edl: 'Mars Sky-Crane / EDL Lander',
    tank_hyper_s: 'Hypergolic Tank S (2,400 kg)',
    tank_cryo_m: 'Cryogenic Tank M (6,500 kg)',
    tank_cryo_l: 'Cryogenic Tank L (14,000 kg)',
    eng_aj10: 'Apollo AJ10 / LMDE (311 s)',
    eng_mle: 'Mars Descent MLE Cluster (325 s)',
    eng_rl10: 'Aerojet RL10C-1 (454 s)',
    solar_s: 'ISS Mini Solar Panel (2 m²)',
    solar_m: 'ROSA Solar Array (4 m²)',
    battery_s: 'Orbit Li-Ion Battery (500 Wh)',
    battery_m: 'Orion/HLS Battery (1,200 Wh)',
    mmrtg: 'NASA MMRTG Plutonium-238',
    ant_lga: 'S-Band Omni Antenna (LGA)',
    ant_hga: 'Ka-Band Deep Space Antenna (HGA)',
    rover_ltv: 'NASA Artemis LTV Rover',
    relay_link: 'Deep Space Relay Network (DSN)',
  } as Record<string, string>,

  instruments: {
    cam_pano: 'Panorama Camera',
    weather_station: 'Weather Station',
    seismometer: 'Seismometer',
    spectrometer: 'Spectrometer',
    sample_drill: 'Sample Drill',
    ice_radar: 'Ice-Penetrating Radar',
  } as Record<string, string>,

  destinations: {
    moon: {
      name: 'Moon',
      objectives: {
        moon_regolith: 'Collect regolith sample in crater',
        moon_panorama: 'Capture landing site panorama photo',
        moon_far_crater: 'Photograph distant crater (over 250 m from lander)',
        moon_weather: 'Deploy weather station (over 250 m from lander)',
      },
    },
    mars: {
      name: 'Mars',
      objectives: {
        mars_rock: 'Analyze rock composition',
        mars_seismo: 'Deploy seismometer',
        mars_core: 'Drill core sample from ancient rock',
        mars_delta_photo: 'Photograph ancient delta (over 250 m from lander)',
        mars_weather: 'Deploy weather station (over 250 m from lander)',
      },
    },
  } as Record<string, { name: string; objectives: Record<string, string> }>,

  events: {
    ev_micrometeor: {
      title: 'Micrometeoroid shower',
      description: 'Micrometeoroid debris is crossing the spacecraft path.',
      choices: ['Rotate spacecraft hull', 'Keep flying ahead'],
    },
    ev_engine_glitch: {
      title: 'Engine anomaly',
      description: 'Main engine thrust is fluctuating.',
      choices: ['Restart sequence', 'Shut down briefly'],
    },
    ev_stage_clamp: {
      title: 'Stage clamp jammed',
      description: 'Stage separation clamp failed to release.',
      choices: ['Rapid override sequence', 'Force release with backup pyro'],
    },
    ev_dust_on_panels: {
      title: 'Static dust on solar panels',
      description: 'Lunar dust is coating the lander solar panels.',
      choices: ['Clean panels (scrub minigame)', 'Ignore'],
    },
    ev_solar_flare: {
      title: 'Solar flare',
      description: 'A solar eruption is disrupting power and signal.',
      choices: ['Take shelter in lander', 'Keep working'],
    },
    ev_micrometeorite_rain: {
      title: 'Micrometeorite rain',
      description: 'Micrometeorites are falling around the astronaut.',
      choices: ['Take cover behind rocks', 'Keep walking'],
    },
    ev_dust_storm: {
      title: 'Dust storm',
      description: 'Power and visibility drop as a dust storm sweeps through.',
      choices: ['Take shelter', 'Push on'],
    },
    ev_dust_devil: {
      title: 'Passing dust devil',
      description: 'A dust whirlwind is moving toward the equipment.',
      choices: ['Step aside', 'Shield equipment'],
    },
    ev_solar_conjunction: {
      title: 'Solar conjunction',
      description: 'Signal to Earth is blocked by the Sun.',
      choices: ['Wait for recovery', 'Attempt uplink anyway'],
    },
  } as Record<string, { title: string; description: string; choices: string[] }>,

  dialogs: {
    intro_1: 'Year 2061. A massive solar storm named the Kappa Event disabled satellites and severed interplanetary communications.',
    intro_2: 'Data archives lost the solar system navigation charts. One lead remains: faint signals from Beacons, time capsules left by legacy probes.',
    intro_3: "I'm Dr. Bil Mark Hawking, Mission Director of the Equatorial Space Agency. Our agency is small and tight on funding, yet full of resolve. Welcome aboard, Arka.",
    intro_4: "I'm NOVA, your AI co-pilot. I'll provide telemetry, stage separation callouts, and a bit of humor. Restoring every Beacon means rebuilding the solar system's comms network.",
    briefing_moon_1: 'The first Beacon is on the Moon. This is a training mission: collect a regolith sample in a crater and capture a landing-site panorama.',
    briefing_moon_2: 'Design a spacecraft that is light, frugal, and safe. Remember: mass, fuel, power, and budget all constrain one another.',
    briefing_mars_1: 'Mars awaits. Your primary objectives: analyze rock composition and deploy a seismometer there.',
    briefing_mars_2: 'Solar panels are weaker on Mars and dust cuts power output. Calculate your power and comms carefully.',
    tutorial_1: 'Design tip: none of the five indicators on the right can be red. Red means No-Go for launch.',
    tutorial_2: 'Flight tip: NASA autopilot flies the whole mission—launch to orbit, transfer burn, and landing. Your job: manage Time Warp (warp buttons or [H] to jump to target) and handle crisis events.',
    tutorial_3: 'Surface tip: watch your oxygen. The lander is your base where oxygen and suit battery recharge, and where you uplink data.',
    nova_flight_start: 'All telemetry online. NASA autopilot has control: engines igniting automatically for ascent to orbit. Monitor telemetry and adjust Time Warp as needed.',
    nova_landing: 'Autopilot initiating powered descent. Watch vertical speed and remaining fuel on the HUD; simulation returns to 1x for a precise touchdown.',
    nova_surface_moon: "Touchdown confirmed. Spot the yellow markers, press Q to scan, and don't forget to return to the lander.",
    nova_surface_mars: "We're on Mars. Dust can reduce solar power and weather shifts fast—plan your route wisely.",
    beacon_moon_1: '...recorded transmission started. If you are hearing this, our network went dark and someone still dared to come.',
    beacon_moon_2: 'We left this message for anyone who refuses to give up. Engineers always start small: one rocket, one signal.',
    beacon_moon_3: 'The next Beacon awaits on a farther world. Keep going.',
    beacon_mars_1: '...second signal locked. You have come this far; we knew you would keep pushing forward.',
    beacon_mars_2: 'Every restored Beacon reconnects a node in the network. Do not let the previous generation message end here.',
    end_1: 'Two Beacons restored, Arka. The network is coming back online thanks to the engineering decisions you made.',
    end_2: 'A new signal detected from the next planet. To be continued on the next world.',
  } as Record<string, string>,
} as const;

const cache = new WeakMap<Catalog, Partial<Record<Lang, Catalog>>>();

/** Mengembalikan katalog dengan teks sesuai bahasa aktif (id = data asli JSON). */
export function localizedCatalog(base: Catalog, lang: Lang): Catalog {
  if (lang === 'id') return base;
  let byLang = cache.get(base);
  if (!byLang) {
    byLang = {};
    cache.set(base, byLang);
  }
  const hit = byLang[lang];
  if (hit) return hit;

  const translated: Catalog = {
    rockets: base.rockets.map((r) => {
      const tr = EN_CATALOG.rockets[r.id];
      if (!tr) return r;
      return {
        ...r,
        name: tr.name,
        stages: r.stages.map((s) => ({ ...s, name: tr.stages[s.id] ?? s.name })),
      };
    }),
    modules: base.modules.map((m) => ({
      ...m,
      name: EN_CATALOG.modules[m.id] ?? m.name,
    })),
    instruments: base.instruments.map((inst) => ({
      ...inst,
      name: EN_CATALOG.instruments[inst.id] ?? inst.name,
    })),
    destinations: base.destinations.map((d) => {
      const td = EN_CATALOG.destinations[d.id];
      if (!td) return d;
      return {
        ...d,
        name: td.name,
        objectives: d.objectives.map((o) => ({
          ...o,
          title: td.objectives[o.id] ?? o.title,
        })),
      };
    }),
    events: base.events.map((ev) => {
      const te = EN_CATALOG.events[ev.id];
      if (!te) return ev;
      return {
        ...ev,
        title: te.title,
        description: te.description,
        choices: ev.choices.map((c, i) => ({ ...c, label: te.choices[i] ?? c.label })),
      };
    }),
    dialogs: base.dialogs.map((d) => ({
      ...d,
      text: EN_CATALOG.dialogs[d.id] ?? d.text,
    })),
  };
  byLang[lang] = translated;
  return translated;
}
