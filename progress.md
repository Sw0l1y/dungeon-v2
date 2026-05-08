Original prompt: Implement isolated Q/U class ability prototype for Sword, Rogue, and Archer on a Codex-only branch without deploying or touching main.

Progress:
- Created isolated branch `codex/class-abilities`.
- Confirmed Q/U already map to `abilityA` for player 1/player 2.
- Added first-pass Sword Cleaving Lunge, Rogue Ricochet Dash, Archer Homing Volley, cooldown bars, and instant-kill immunity flags for Pulsar/Boss.
- Verified in local browser smoke tests: Sword Q moved/damaged, Rogue Q killed low-tier enemies and left Pulsar alive, Archer Q fired/damaged, P2 U triggered an ability, and no console errors appeared.

TODO:
- Tune cooldowns/damage/ranges after hands-on play.
- If online mode should support abilities, extend remote input snapshots to include `abilityA`.
