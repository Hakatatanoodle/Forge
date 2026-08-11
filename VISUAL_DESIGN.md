# FORGE — Visual Design Spec

**Status:** v1 — theme system + flagship FORGE + ANIME/One Piece case study. Other themes drafted.
**Basis:** PRODUCT_DESIGN.md (identity, reward economy) · UI_LAYOUT.md (dashboard / reward / start-flow layouts) · existing theme infra in style.css (`:root` variables + `[data-theme="x"]` overrides).

---

## The design principle: THEMATIC COHERENCE

> **A theme is not a color tint. It's a complete world.** Every theme must transport the user: color, type, texture, motion, rank identity — all speaking the same language.

The user's rule, stated plainly: *"One Piece theme should feel like One Piece — everything."* This generalizes to every theme:
- **VENOM** → feel venomous
- **HACKER** → feel inside the machine
- **HEISENBERG** → feel like precision chemistry
- **VOID** → feel the silent dark
- **MINECRAFT** → feel the blocky grind
- **FORGE** → feel the heat of the hammer

If you can swap a theme's accent color and nothing else changes, the theme failed.

---

## The Theme Contract (every theme must fill all 7)

1. **World statement** — one line: what world is this, what's the fantasy.
2. **Color roles** — the full palette (see roles below), not just an accent.
3. **Type stack** — display / body / mono, chosen from the loaded fonts.
4. **Texture** — grain, pattern, motif.
5. **Rank identity** — rank names (+ optional icon motif) for this world.
6. **Signature elements** — what START, +XP, streak flame, level-up *are* in this world.
7. **Sound personality** — (parked, future) what reward/level-up sound like here.

### The color-role system (extends existing `:root` variables)

| Role | Existing | Meaning |
|---|---|---|
| `--bg` | ✓ | base background |
| `--bg-2/3/4` | ✓ | surfaces (cards, inputs, elevated) |
| `--text-primary/secondary/dim` | ✓ | text hierarchy |
| `--accent` | ✓ | primary action (START, LOCK IN) |
| `--accent-bright` | ✓ | hover / highlight |
| `--accent-dim` | ✓ | shadow / glow base |
| `--accent-glow` | ✓ | ambient glow |
| `--xp-grad` | ✗ new | XP fill gradient (now hardcoded per theme) |
| `--success` | ✗ new | task done / level-up moment |
| `--danger` | ✗ new | abandon / break |
| `--streak` | ✗ new | the streak flame color |
| `--font-display` | ✗ new | display face per theme |
| `--font-body` | ✗ new | body face per theme |

**Build note:** move per-theme component hacks (e.g. `.xp-bar-fill` overrides) into these roles so each theme defines a *palette*, not a list of patches.

---

## Flagship: FORGE (default) — reference implementation

- **World:** "You are the blacksmith and the steel. The forge is where you're hammered into shape. Session = striking metal, XP = heat, rank = forged identity."
- **Color:** charcoal `#0a0a0a` base, ember orange `#e85d04` accent, bright `#ff7b1a`. XP bar = **ember gradient** (deep red → orange → yellow-hot tip). START = molten edge glow.
- **Type:** display **Barlow Condensed Black** (industrial-stencil energy), mono **Share Tech Mono** (data / rank / numbers), body **Barlow**.
- **Texture:** existing grain + subtle ember glow on XP. Industrial discipline (Hollow Knight: restraint wins).
- **Rank:** INITIATE → APPRENTICE → OPERATOR → SPECIALIST → VETERAN → ELITE → COMMANDER → FORGE MASTER. Motif: hammer → anvil → flame → gear.
- **Signature:** START = hot-metal edge glow; +XP = ember text glow; streak = orange flame; level-up = "FORGED LVL 3."

---

## Case study: ANIME = ONE PIECE (the user's example, done thoroughly)

- **World statement:** *"You sail the Grand Line. Every session is a voyage, every task a logbook entry. The One Piece is your endgame."*

- **Color roles:**
  | Role | Value | Where it comes from |
  |---|---|---|
  | `--bg` | `#0a1128` | deep Grand-Line ocean navy |
  | `--bg-2/3/4` | `#131e3d` / `#1a2a4f` / `#22335f` | layered deck planks |
  | `--text-primary` | `#f2e8d0` | parchment / old sail |
  | `--text-secondary` | `#9fb0c8` | sea fog |
  | `--text-dim` | `#5a6b8c` | underwater depth |
  | `--accent` | `#f2b632` | sun gold — straw hat, treasure |
  | `--accent-bright` | `#ffd75e` | treasure flash |
  | `--accent-dim` | `#8a5a00` | deep amber |
  | `--accent-glow` | `rgba(242,182,50,.15)` | golden haze |
  | `--success` | `#e05548` | coral red — Luffy's vest |
  | `--danger` | `#b0302a` | dark crimson |
  | `--streak` | gold flame | the streak is treasure-strength |
  | `--xp-grad` | amber → gold → white-hot | burning log |

- **Type:** display **Barlow Condensed Black** (bold pirate-adventure), mono **Share Tech Mono** (the ship's *logbook* — intention lines, session data feel like journal entries), body **Barlow**.

- **Texture:** parchment grain on cards · faint wave-lines on the background · subtle deck-wood stripes on surfaces · **jolly-roger / skull motif** reserved for rank moments and level-up.

- **Rank identity:** Cabin Boy → Sailor → Pirate → Super Rookie → Captain → Warlord → Emperor → **Pirate King**. (Draft — user to confirm.)

- **Signature elements (this is where it FEELS One Piece):**
  - **START button** = a gold bounty-board button with a treasure shine.
  - **Level-up ceremony** = *"BOUNTY INCREASED: 500,000,000"* — leveling up raises your wanted poster's bounty. A poster flash, not just a number.
  - **+XP count-up** = gold coins streaming; text glow in treasure gold.
  - **Streak** = gold flame, "days at sea."
  - **The "I will" declaration** = styled as a logbook entry line.
  - **Session complete** = "LAND HO" moment; reward ceremony in parchment + gold.

The One Piece theme is the proof of the principle: same layouts, same screens — but you'd never mistake it for FORGE. It *feels* like sailing.

---

## The other themes at a glance

| Theme | World | Palette | Type | Texture | Rank flavor |
|---|---|---|---|---|---|
| **VENOM** | "You are the toxin." | sick-black base, electric toxic green `#00e676`, slime glow | Rajdhani bold (sleek, toxic) | toxic drip glow, gooey highlights | venom-flavored |
| **HACKER** | "Inside the machine." | pure black, phosphor green `#00ff41` | Share Tech Mono everywhere (terminal purity) | CRT scanlines (exists), matrix rain hint | script-kiddie → root |
| **HEISENBERG** | "Precision chemistry." | black → gold `#f5c542`, blue-crystal `#2b6cff` accent | clean geometric (Rajdhani) | subtle crystal glint | apprentice chemist → "the one who knocks" |
| **VOID** | "The silent dark." | near-black, deep blood red `#8b0000`, negative space IS the feature | sparse — Cormorant Garamond (quiet elegance, loaded!) | minimal grain only | silent titles |
| **MINECRAFT** | "The blocky grind." | grass / dirt / stone warmth | **Press Start 2P** (loaded, pixel) | pixel borders, blocky corners | villager → end-game |
| **FORGE** | flagship above | charcoal + ember | Barlow Condensed Black / mono / Barlow | grain + ember glow | INITIATE → FORGE MASTER |

---

## Build implications (contained — no JS machinery touched)

1. Extend the existing `[data-theme]` variable system. Add the new roles (`--xp-grad`, `--success`, `--danger`, `--streak`, `--font-display`, `--font-body`) to `:root` and each theme.
2. Refactor per-theme component hacks into role variables.
3. Type per theme via `--font-*` roles (fonts already loaded — Press Start 2P, Cormorant Garamond are currently unused!).
4. Texture via optional per-theme classes + the existing grain.
5. Theme-flavored rank names already exist in app.js `THEME_RANKS` — extend for ANIME→One Piece + confirm the draft.

## Next phase (after visual sign-off)

**UX flows** — wire the Q8 promises into interactions (add-task toast, quest-tap-set-objective, reward beats) · then **build** the presentation layer.
