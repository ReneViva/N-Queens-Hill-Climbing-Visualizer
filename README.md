# Queens_by_Rene

An offline educational web application for studying four hill-climbing local-search variants through the Queens problem: Standard / Steepest, Stochastic, First-Choice, and Random-Restart. The board, successor matrix, debugger, pair calculator, candidate previews, history, and explanations show how a complete board changes one queen at a time. The selector changes the actual search behavior and its playback, flow, debugger, matrix, and statistics.

**Open online:** [Queens_by_Rene](https://reneviva.github.io/Queens_by_Rene/). The public site is hosted on GitHub Pages and requires no account to visit.

Download this repository using **Code → Download ZIP**, then extract it into a folder of your choice. You can also clone the repository. Keep the application files together in the extracted or cloned folder.

## Open the application

Double-click **index.html** in this folder. It opens in your browser and works offline. No installation, internet connection, Node.js, npm, Python, backend, or local server is required. Keep the application files together. Use a current browser with JavaScript enabled.

## Files

- **index.html** — application layout and controls.
- **styles.css** — responsive dark/light design, chessboard styling, and animations.
- **engine.js** — state validation, attacking-pair calculation, successor generation, variant selection logic, move classification, presets, and mathematical self-tests.
- **app.js** — rendering, mode-specific phased execution, playback controls, preview/inspection, history, statistics, and animation.
- **learning.js** — six expandable learning sections, configuration-specific counts, variant metadata/pseudocode/flow, and a study comparison table.
- **README.md** — these instructions.
- **.nojekyll** — serves the plain static application directly on GitHub Pages.

All scripts are plain local JavaScript. No external fonts, libraries, or network services are needed.

## Configure a board

Square N-Queens Mode is enabled by default with N = 4. Set N to generate an N × N board. Disable square mode to configure rows and columns separately. Each dimension accepts integers from **1 to 20**; there is always exactly one queen per column.

Choose a random initial state or enter a custom array such as `[4,3,4,2]`. The array must contain exactly one valid row number for each column. Rows and columns are displayed starting at 1:

```text
state[column] = row
[4,3,4,2]
Q1 → column 1, row 4
Q2 → column 2, row 3
Q3 → column 3, row 4
Q4 → column 4, row 2
```

Generate Board applies the configuration. New Random Board makes another complete arrangement. Reset returns to the initial state of the active experiment. Presets provide checked 4-queen examples, a solved state, stuck/flat examples, and the standard 8 × 8 configuration.

If columns exceed rows, at least two queens must share a row, so h = 0 is impossible. Square N = 2 and N = 3 also have no solution. Other rectangular configurations are not promised to be feasible. They remain useful for studying conflict reduction.

## Algorithm and heuristic

The heuristic is a **cost**, so smaller values are better. Standard mode uses steepest descent: it does not choose a queen first. It compares every legal one-queen move; the winning successor identifies both the queen and destination row. Other modes use the same states and cost while changing neighbor evaluation and selection.

```text
current = initial complete state
while current.h != 0:
    successors = every one-queen move to another row in its column
    evaluate h for each entire resulting board
    best = a successor with minimum h
    if no successor exists:
        stop
    if best.h >= current.h:
        stop, unless a bounded equal-cost sideways move is enabled
    current = best
```

**h(state) is the total number of attacking pairs on the entire board.** Queens attack if their rows match or `abs(row[i] - row[j]) == abs(i - j)`. Iterate over `i < j` so every pair is counted once. Column attacks cannot occur under the one-queen-per-column representation. Re-evaluate all pairs for every candidate, including pairs unrelated to the moved queen.

For `[4,3,4,2]`, **h = 3**. The attacking pairs are:

- Q1–Q2: diagonal (`|4−3| = |1−2| = 1`).
- Q1–Q3: same row (row 4).
- Q2–Q3: diagonal (`|3−4| = |2−3| = 1`).

The pasted request’s Q2–Q4 pair is corrected here: its row distance is 1 and column distance is 2, so it is not an attack. Moving Q1 to row 1 gives `[1,3,4,2]` with h = 1 because Q2–Q3 still attack. A safe moved queen does not imply that the whole candidate board has h = 0.

Both `[2,4,1,3]` and `[3,1,4,2]` have h = 0. Since conflict counts cannot be negative, any attainable h = 0 state is a solved/global minimum. In an infeasible configuration the attained global minimum is positive.

This is **local search, not Greedy Best-First Search**. The search maintains the current board and inspects neighboring boards. It has no frontier, search tree, or search-tree path reconstruction. The visible history is a study record, not a frontier.

## Choose a hill-climbing variant

Use **How do you want to run hill climbing?** near the top. The Selected Algorithm explanation, pseudocode, flow, debugger variables, and matrix reflect the chosen mode. Sideways moves and manual Force Move remain separate controls.

Changing the variant keeps the current board, history, and experiment totals, and begins a fresh neighborhood scan. Use Reset before a fresh experiment if you want counters to measure one variant alone.

| Variant | What gets evaluated | Which normal move is taken |
| --- | --- | --- |
| Standard / Steepest | All successors each iteration. | A successor with minimum h, using the tie rule among equally best choices. |
| Stochastic | All successors to identify the improving set. | A randomly selected improving successor, uniformly or weighted by improvement. |
| First-Choice | Candidates in a randomized order, one at a time; scanning stops immediately at the first strict improvement. | The first strictly improving candidate encountered. |
| Random-Restart | All successors during each standard/steepest attempt. | A standard move within each attempt; after becoming stuck, start from a new random complete board within the restart budget. |

**Stochastic Selection** supports two probability rules. With k improving candidates, uniform selection assigns each probability `1/k`. Weighted selection assigns `p = Δh / sum(Δh)`, where `Δh = current_h − candidate_h`. For current h = 5 and candidate costs 4, 3, and 1, weights are 1, 2, and 4; probabilities are 1/7, 2/7, and 4/7. The random draw is shown before movement. A valid draw may choose a move other than the lowest-h candidate.

**First-Choice** shuffles move descriptors without evaluating their h-values. It previews one candidate, calculates the whole-board cost, and rejects or immediately accepts it. Untested matrix values remain `?`. The candidate order and `checked / total` count show work actually performed. **Reveal all h values for learning** is a separate inspection action and does not add to algorithm-evaluation statistics. Clicking an untested candidate may likewise evaluate it for inspection without marking it as algorithm work.

**Random-Restart** begins with the configured current board for attempt 1. A stuck explanation and visible restart transition precede subsequent random boards. **Maximum Restarts** defaults to 100, counting new starts after the initial attempt; 100 restarts permit up to 101 attempts. **Unlimited until solved** removes the cap. Restarting clears the attempt iteration and consecutive sideways counters while preserving experiment totals, best observations, and history.

## Three different counts

For **R rows and C columns**:

| Quantity | Formula | 4 × 4 | 8 × 8 |
| --- | --- | ---: | ---: |
| Total complete states | R^C | 256 | 16,777,216 |
| Successors of one state | C(R−1) | 12 | 56 |
| Pairs tested for one h | C(C−1)/2 | 6 | 28 |

Each queen has R−1 destination rows because its current row is not a move. For square boards, the successor count is N(N−1). The h-value counts how many of the tested pairs actually attack; it is neither the total state count nor the successor count.

## Playback controls

- **Play** automatically advances the selected algorithm at the chosen speed when **Run automatically** is checked (the default). With it unchecked, Play advances one step. **Pause** stops progression.
- **Next Step** performs one visible technical operation. **Next Iteration** advances to the next complete board state or stopping/restart decision while retaining intermediate information.
- **Speed** selects 0.25×, 0.5×, 1× (default), 1.5×, 2×, or 4× playback and can change while playing.
- **Previous / History** inspects a recorded state. Inspection does not change the active algorithm state. **Return to current state** ends inspection; **Restore this state** explicitly makes the inspected state current.
- **Reset** begins the active experiment again from its initial arrangement.

History records moves, random restarts, restorations, and stopped scans. Inspecting an entry exposes its recorded algorithm, source board, evaluated candidate costs, and selection information. Stochastic entries retain probabilities and the random draw; first-choice entries retain the random candidate order and checks. A stopped scan is recorded even though it committed no move. Restoring a board retains experiment totals and history and resets the consecutive sideways streak.

The nine main stages for standard mode are:

1. Inspect the current state and h.
2. Generate all successors.
3. Calculate h for every entire candidate board.
4. Highlight the minimum candidate h.
5. Select the specific queen.
6. Highlight its destination row.
7. Move the queen.
8. Recalculate the current board’s h.
9. Begin the next iteration or report solved/stopped.

Stochastic playback identifies improving moves, shows probabilities, and reveals the random selection before selecting/moving the queen. First-choice repeats candidate inspection, evaluation, and reject/accept operations until a strict improvement is accepted or the order is exhausted. Random-restart adds a visible stuck/restart transition between attempts. Flow-node and pseudocode highlighting track the selected mode.

The Algorithm Debugger always shows mode, current state, current h, iteration, and status. Standard adds successor counts and best choices; stochastic adds eligible counts, probabilities, and the random draw; first-choice adds random order, candidate index/cost, checked count, and accept/reject status; restart adds restart number/limit, attempt/total iterations, and best h/state. With manual tie-breaking in standard/restart, progression waits for a best candidate to be selected. Other standard tie rules are random among equally best successors (the default) and first by column/row.

## Successor previews and manual experiments

Every numeric successor-matrix cell is the h of the **whole resulting board**. A dash identifies the row already occupied by that column’s queen. Standard/restart compare all costs; stochastic highlights eligible improvements and their probabilities; first-choice initially hides untested costs. Hover or select a candidate to inspect its move, candidate array, and remaining attacks. **Preview** displays its board without committing it. **Apply this move** changes the live state; **Return to current state** cancels inspection.

Select a queen on the chessboard to highlight destination rows in its column and their candidate h-values. Select a destination to inspect the move. A move that increases h explains the cost increase and requires **Force Move**, because standard hill climbing would not take it. Manual experiments may also choose a candidate other than the steepest move.

The “Why is h = X?” panel lists attacking pairs and coordinates. “Calculate h Manually” shows every tested pair, row and diagonal tests, and the sum. Display settings toggle attack lines, coordinates, queen IDs, and destination heuristic labels.

## Stops, sideways moves, and restart

With sideways moves off, standard mode stops when `best.h >= current.h`. Stochastic stops when its improving set is empty. First-choice must exhaust the randomized order before concluding that no improvement exists. Random-restart starts another attempt when permitted. A lack of immediately improving neighbors alone does not prove that a solution is absent.

- If every neighbor has a greater h, the state is a **strict local minimum**.
- If no neighbor has a smaller h but at least one ties, it is a **non-strict local minimum with a flat neighbor**.
- A **plateau** is a connected equal-cost region. A **shoulder** has a downhill exit reachable by equal-cost moves. One immediate neighborhood cannot establish whether the entire flat region has an exit.
- At h = 0 the problem is solved.

**Allow Sideways Moves** is off by default. When enabled, equal-cost moves are permitted up to the consecutive limit (default 100). A strict improvement resets that count. Strict improvements take priority in every mode. First-choice remembers equal candidates but only considers them after exhausting the order without a strict improvement. Stochastic uses uniform probabilities for an equal-cost fallback, since all improvements Δh would be zero. Equal-cost moves can help cross a flat region but can also cycle, which is why they are bounded.

**Restart From Random State** begins another attempt from a complete random board. Random-Restart mode and the retained automatic-restart control can restart when an attempt becomes stuck, subject to the configurable budget. Restarting does not guarantee success in a finite number of attempts or make an infeasible board solvable. Unlimited mode can continue indefinitely, so use Pause to stop it.

Automatic restarts are disabled for configurations already known to be impossible: more columns than rows, or square N = 2 or N = 3. You can still inspect them, change search rules, force moves, or restart manually. Maximum Restarts accepts 0–100,000; its default is 100.

## Run statistics and study comparison

Statistics show the selected algorithm and board size, iterations, candidate boards evaluated by the algorithm, restarts, current/final h, best h/state, and terminal attempt counts. Stochastic also records random selections. A solved message identifies h = 0, the final state, iterations, evaluations, and restart count when applicable.

**Best evaluated h / state** includes complete candidate boards evaluated by the search and current states visited during the experiment. It excludes manual study previews and reveal-all calculations. The best candidate may not have been chosen by stochastic or first-choice selection, so this statistic can differ from the current board’s h. Solved status always depends on the actual current board having h = 0.

The **Standard full-scan baseline** is `scans begun × C(R−1)`. It illustrates the candidate cost of evaluating a complete neighborhood for every scan started, including an in-progress or unsuccessful final scan; it is not the result of running Standard on the same path. Actual first-choice evaluations can be lower because scanning stops early. Manual previews and reveal actions are inspection work and do not count as algorithm candidate evaluations. Move/iteration counts and scan counts answer different questions: a stopped scan evaluates neighbors without committing a move.

The study comparison panel contrasts candidate evaluation, selection rules, advantages, and stuck behavior. It is a static study table; the optional batch “Compare Algorithms” runner is not implemented. Randomized runs may have different paths, so a single run does not establish that one variant is always faster or better.

## Validation and developer tests

The application includes JavaScript self-tests in its developer/self-test panel. Mathematical checks include row attacks, diagonal attacks, unique-pair counting, whole-board h, solved 4-queen boards, successor generation, unchanged source states, and the 4 × 4 / 8 × 8 successor counts. Run them in the application to inspect the current results.

Completed validation for this version:

- **109/109 automated engine self-tests passed**, including variant selection, uniform/weighted probabilities, lazy first-choice evaluation, sideways policies, and exhaustive checks of all 256 four-queen states and their 3,072 successor boards.
- **91/91 browser UI checks passed** in local Chrome with `index.html` opened through `file://`. All four variants were exercised on 4 × 4 and 8 × 8 boards. An instrumented first-choice case performed exactly 1 candidate-evaluation call out of 12 possible moves before accepting the first improvement.
- Browser checks covered stochastic probabilities, consecutive sideways limits of 0 and 1, visible restart countdowns and restart caps, Play/Pause/speed changes, phase and iteration stepping, manual tie selection, forced worse moves, candidate previews, history inspection/restoration, and custom-input validation.
- Source-board regression checks verified that manual candidate previews on the new current board cannot overwrite costs in a retained matrix from the previous iteration. Study costs are cached by source state and move together.
- Responsive checks passed at viewport widths **1,560, 1,100, 768, and 390 pixels**, including a 20 × 20 board. A 20 × 1 board remained within the board’s 540-pixel height bound. Refresh and the exercised flows produced **no JavaScript console errors**.
- The browser was set to **network offline** and the local page reloaded successfully. JavaScript syntax checks passed, and all 109 engine tests passed again during the final audit.

These results describe the completed mathematical and browser checks; they do not guarantee that every random run will solve the board.

For a manual browser check, load `index.html`, inspect the browser console, and try 4 × 4 and 8 × 8 with every variant:

- Standard: all successors are evaluated and a minimum-h candidate is selected.
- Stochastic: normal choices strictly improve h; uniform/weighted probabilities sum to 1, and draws may select a non-best improving candidate.
- First-choice: candidates follow the displayed random order, are evaluated one at a time, and scanning stops immediately at the first strict improvement. Unchecked h-values stay hidden unless deliberately revealed for learning.
- Restart: a stuck attempt explains the stop, then transitions to a random board; the counter and budget are respected.
- Sideways: equality is allowed only when enabled and below the limit; first-choice cannot use an early equal candidate before ruling out later strict improvements.

Also preview a board whose unmoved queens still attack. Exercise Play, Pause, Next Step, Next Iteration, a custom state, a forced worse move, history inspection/restoration, Reset, refresh, and a narrow window. Reset should clear playback and experiment counters. The self-test panel reports automated checks; interactive behavior and layout must be checked in the browser separately.

## Practical limits

Boards are limited to 20 rows and 20 columns to keep the full successor matrix and pair explanations readable. The exhaustive successor display grows as C(R−1), and each full heuristic evaluation checks C(C−1)/2 pairs. The app is an educational local-search simulator, not a proof of feasibility or a guarantee that one run will find a solution. Random choices can produce different paths. Large boards may require scrolling, especially on a phone.
