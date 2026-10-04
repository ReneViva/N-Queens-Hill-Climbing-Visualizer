/* Educational content for the offline Queens local-search visualizer.
 * All displayed positions use one-based row/column labels.
 * This file has no dependencies and does not change the search state.
 */
(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
    });
  }

  function dimension(value) {
    var number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 20 ? number : 4;
  }

  function exactStateCount(rows, columns) {
    return (BigInt(rows) ** BigInt(columns)).toLocaleString('en-US');
  }

  function topic(title, body, initiallyOpen) {
    return '<details class="concept"' + (initiallyOpen ? ' open' : '') + '>' +
      '<summary>' + escapeHtml(title) + '</summary>' +
      '<div class="concept-body">' + body + '</div></details>';
  }

  // These are plain-text strings. The UI escapes them when building panels.
  // A move descriptor identifies (column, destination row); it has no h until
  // the corresponding entire candidate board has actually been evaluated.
  var algorithms = {
    standard: {
      name: 'Standard / Steepest Hill Climbing',
      simple: 'Check every one-queen move and choose a resulting board with the smallest h.',
      technical: 'Generate all C(R−1) successors and calculate the total attacking pairs for each entire board. Find the minimum h, then use the tie rule to choose among equally best successors. Accept a strict improvement; an equal-cost best move is admissible only when sideways moves are enabled and the consecutive limit permits it.',
      visual: 'The matrix reveals all candidate costs, highlights the lowest h, selects a queen, highlights its destination, and animates the move. The nine main steps separate selection, destination, movement, and re-evaluation.',
      advantages: 'Chooses the strongest immediate reduction in h. Every candidate is available for comparison, and deterministic tie-breaking makes an experiment reproducible.',
      disadvantages: 'Evaluates every neighbor on each iteration, which costs more on larger boards. A strong immediate move can still lead to a local minimum or flat region.',
      stuck: 'Stop when no improving move exists and no permitted sideways move remains. Explain strict local minimum, flat neighbor, or sideways-limit exhaustion. A one-neighborhood check cannot prove a shoulder or global infeasibility.',
      pseudocode: [
        'current = initial_state',
        'while current.h > 0:',
        '    successors = generate_all_successors(current)',
        '    calculate_whole_board_h_for_all(successors)',
        '    best = all_successors_with_minimum_h(successors)',
        '    if not admissible(best, current, sideways_policy): STOP',
        '    chosen = break_tie(best)',
        '    chosen_queen = chosen.column',
        '    chosen_row = chosen.row',
        '    current = apply(chosen)',
        '    current.h = calculate_h(current)',
        'SOLVED  # current.h == 0'
      ],
      flow: ['CURRENT STATE', 'GENERATE ALL SUCCESSORS', 'CALCULATE ALL h VALUES', 'FIND MINIMUM h', 'IMPROVING OR PERMITTED SIDEWAYS?', 'SELECT QUEEN', 'HIGHLIGHT DESTINATION', 'MOVE', 'RECALCULATE / REPEAT']
    },
    stochastic: {
      name: 'Stochastic Hill Climbing',
      simple: 'Randomly choose among improving moves instead of always selecting the smallest h.',
      technical: 'Evaluate every successor to identify the moves with successor.h < current.h. For k improving moves, uniform probability is 1/k. In weighted mode, Δh = current.h − candidate.h and p(candidate) = Δh / sum(Δh). A move with less improvement can still be selected. If no strict improvement exists, a permitted sideways fallback samples equal-cost moves uniformly.',
      visual: 'The matrix reveals all costs, dims non-improving moves, and highlights all improving moves with probabilities. A separate random-selection phase shows the draw and chosen interval before the queen moves.',
      advantages: 'Different random choices explore different downhill paths. Weighted selection favors stronger improvements while retaining other improving candidates.',
      disadvantages: 'Still evaluates every neighbor in this implementation. The selected move may reduce h less than steepest descent, and the run can still become stuck.',
      stuck: 'If there are no strict improvements, consider equal-cost moves only when sideways moves are enabled and below the consecutive limit. Otherwise stop and explain the neighborhood. Random selection alone cannot escape a strict local minimum.',
      pseudocode: [
        'current = initial_state',
        'while current.h > 0:',
        '    successors = generate_all_successors(current)',
        '    calculate_whole_board_h_for_all(successors)',
        '    improving = [s for s in successors if s.h < current.h]',
        '    eligible = improving or permitted_equal_moves(successors)',
        '    if eligible is empty: STOP',
        '    probabilities = uniform_or_delta_weights(eligible)',
        '    chosen = random_draw(eligible, probabilities)',
        '    chosen_queen, chosen_row = chosen.column, chosen.row',
        '    current = apply(chosen)',
        '    current.h = calculate_h(current)',
        'SOLVED  # equal-cost fallback always uses uniform weights'
      ],
      flow: ['CURRENT STATE', 'GENERATE ALL SUCCESSORS', 'CALCULATE ALL h VALUES', 'KEEP IMPROVING MOVES', 'DISPLAY PROBABILITIES', 'RANDOM SELECTION', 'HIGHLIGHT DESTINATION', 'MOVE', 'RECALCULATE / REPEAT']
    },
    'first-choice': {
      name: 'First-Choice Hill Climbing',
      simple: 'Test randomly ordered neighbors one at a time and immediately accept the first move that lowers h.',
      technical: 'Shuffle move descriptors without evaluating their h-values. Build and evaluate one candidate board at a time. Reject non-improvements and stop scanning immediately on the first strict improvement; unchecked neighbors remain unevaluated. Equal-cost candidates are remembered, but a sideways fallback is considered only after the entire order is exhausted without any strict improvement.',
      visual: 'Untested matrix costs stay as ?. The randomized order and checked count are visible. Each candidate gets separate inspect, whole-board evaluation, and reject/accept steps. Reveal all h values for learning is a separate inspection action; it does not count as algorithm work.',
      advantages: 'Often evaluates far fewer candidate boards when improving moves are plentiful. It can be useful when the neighborhood is large.',
      disadvantages: 'The first improvement need not be the strongest. If no strict improvement exists, every neighbor must still be tested to establish that fact. Random order changes the path.',
      stuck: 'Exhaust all move descriptors before declaring no strict improvement. If equal-cost candidates were found and the sideways policy permits them, take an equal-cost fallback; otherwise stop. Never accept an equal move early while a strict improvement may remain untested.',
      pseudocode: [
        'current = initial_state',
        'while current.h > 0:',
        '    order = shuffle(move_descriptors(current))  # no h calls',
        '    chosen = none; equal = []',
        '    for move in order:',
        '        candidate = preview_one_move(current, move)',
        '        candidate.h = calculate_h(candidate)  # whole board',
        '        if candidate.h < current.h:',
        '            chosen = candidate; break  # accept immediately',
        '        if candidate.h == current.h: equal.append(candidate)',
        '        reject_as_strict_improvement(candidate)',
        '    if chosen is none: chosen = permitted_sideways_fallback(equal)',
        '    if chosen is none: STOP',
        '    chosen_queen, chosen_row = chosen.column, chosen.row',
        '    current = apply(chosen)',
        '    current.h = calculate_h(current)',
        'SOLVED'
      ],
      flow: ['CURRENT STATE', 'SHUFFLE UNEVALUATED MOVES', 'INSPECT NEXT CANDIDATE', 'CALCULATE WHOLE-BOARD h', 'BETTER? ACCEPT / REJECT', 'SELECT ACCEPTED QUEEN', 'HIGHLIGHT DESTINATION', 'MOVE', 'RECALCULATE / REPEAT']
    },
    restart: {
      name: 'Random-Restart Hill Climbing',
      simple: 'Run steepest hill climbing; when stuck, start again from a new random board.',
      technical: 'Use the current configured board for attempt 1, then run standard steepest descent within each attempt. After a non-solved stop, record the stuck attempt and start a new complete random state if the restart budget allows it. Maximum restarts counts new starts after attempt 1: the default 100 permits at most 101 attempts. Unlimited until solved removes this bound; Pause remains available.',
      visual: 'Each attempt uses the full standard matrix. A stuck explanation and visible restart transition precede the new board. Restart number, current/total iterations, best h and state, candidate evaluations, and successful/stuck attempts remain visible.',
      advantages: 'Fresh random starts can reach different regions of state space and escape a poor initial basin. Retaining the best observed state supports comparison across attempts.',
      disadvantages: 'May repeat unhelpful attempts and perform many evaluations. Finite restarts do not guarantee a solution, and unlimited mode can run forever on an infeasible configuration.',
      stuck: 'Record the failed/stuck attempt, show why no admissible move remains, and restart if below the configured limit. Stop at the restart limit or h = 0. A new start resets the consecutive sideways count and iterations for that attempt.',
      pseudocode: [
        'current = initial_state; restart = 0',
        'while True:',
        '    while current.h > 0:',
        '        successors = generate_all_successors(current)',
        '        calculate_whole_board_h_for_all(successors)',
        '        best = all_successors_with_minimum_h(successors)',
        '        if not admissible(best, current, sideways_policy): break',
        '        chosen = break_tie(best)',
        '        current = apply(chosen)',
        '        current.h = calculate_h(current)',
        '    if current.h == 0: SOLVED; break',
        '    record_stuck_attempt(current)',
        '    if restart_limit_reached and not unlimited: STOP',
        '    show_restart_transition()',
        '    current = random_complete_state()',
        '    restart += 1; reset_attempt_and_sideways_counters()'
      ],
      flow: ['CURRENT ATTEMPT', 'GENERATE ALL SUCCESSORS', 'CALCULATE ALL h VALUES', 'FIND MINIMUM h', 'IMPROVE / STUCK?', 'SELECT QUEEN', 'HIGHLIGHT DESTINATION', 'MOVE', 'REPEAT / RANDOM RESTART']
    }
  };

  Object.keys(algorithms).forEach(function (key) {
    Object.freeze(algorithms[key].pseudocode);
    Object.freeze(algorithms[key].flow);
    Object.freeze(algorithms[key]);
  });
  Object.freeze(algorithms);

  function renderComparison() {
    return '<div class="concept-body"><p>All four variants minimize the same whole-board cost. The difference is how they evaluate neighbors and choose the next state.</p>' +
      '<div class="pair-table-scroll"><table class="algorithm-comparison"><thead><tr><th>Variant</th><th>Candidate evaluations</th><th>Normal move</th><th>Advantage</th><th>When stuck</th></tr></thead><tbody>' +
      '<tr><th>Standard / steepest</th><td>All successors each iteration.</td><td>A lowest-h improving successor; ties use the selected rule.</td><td>Largest immediate reduction.</td><td>Stop or use a permitted equal-cost fallback.</td></tr>' +
      '<tr><th>Stochastic</th><td>All successors to discover the improving set.</td><td>A random improving successor, uniformly or weighted by Δh.</td><td>Different downhill paths; best h need not be chosen.</td><td>Stop or sample permitted equal-cost moves uniformly.</td></tr>' +
      '<tr><th>First-choice</th><td>Random order, one at a time; stop at the first strict improvement.</td><td>The first improving successor encountered.</td><td>Often fewer evaluations.</td><td>Only after exhausting the order, stop or consider a permitted equal-cost fallback.</td></tr>' +
      '<tr><th>Random-restart</th><td>All successors within each steepest-descent attempt.</td><td>A lowest-h successor within an attempt.</td><td>Fresh starts explore other basins.</td><td>Show the stop, then create a new random board within the restart budget.</td></tr>' +
      '</tbody></table></div>' +
      '<p><strong>Uniform stochastic:</strong> k eligible improving moves each have probability 1/k. <strong>Weighted stochastic:</strong> p = (current h − candidate h) / sum of all improvements. At current h = 5, candidate costs 4, 3, and 1 have weights 1, 2, and 4, giving probabilities 1/7, 2/7, and 4/7 (about 14.3%, 28.6%, and 57.1%).</p>' +
      '<p><strong>Sideways is an independent extension:</strong> equal-cost movement requires its toggle and remaining consecutive allowance. Strict improvement takes priority. First-choice retains equal candidates until all strict improvements have been ruled out.</p>' +
      '<p class="concept-note"><strong>This is local search, not Greedy Best-First Search.</strong> The algorithm maintains a current board and inspects its neighbors. It maintains no frontier, search tree, or path-reconstruction procedure. Visible history is a study record; it is not a search frontier.</p>' +
      '<p>Algorithm evaluation statistics count boards actually evaluated by the search. Manual previews and “Reveal all h values for learning” are inspection work. A full-neighborhood comparison count is a reference cost for the same number of iterations, not a measured run of another algorithm.</p></div>';
  }

  function render(rows, columns) {
    rows = dimension(rows);
    columns = dimension(columns);
    var successors = columns * (rows - 1);
    var pairTests = columns * (columns - 1) / 2;
    var r = escapeHtml(rows);
    var c = escapeHtml(columns);
    var successorText = escapeHtml(successors.toLocaleString('en-US'));
    var pairText = escapeHtml(pairTests.toLocaleString('en-US'));
    var stateText = escapeHtml(exactStateCount(rows, columns));
    var feasibility = columns > rows
      ? '<p class="concept-note">This configuration has more queens than rows. With one queen per column, at least two queens must share a row, so h = 0 is impossible. The search can still demonstrate how conflicts are reduced.</p>'
      : '<p class="concept-note">A solution is not guaranteed for every rectangle. For square N-Queens, N = 2 and N = 3 have no non-attacking solution; N = 1 does. Search failure by itself does not establish whether a solution exists.</p>';

    return [
      topic('1. States, complete states, and neighbors',
        '<p>A <strong>state</strong> is one complete arrangement of queens. In this formulation there is exactly one queen in each column, even when queens attack each other.</p>' +
        '<p><strong>Complete-state formulation</strong> means all ' + c + ' queens are present from the beginning. Local search changes their positions; it does not build a partial placement by adding queens.</p>' +
        '<p class="formula"><code>state[column] = row</code></p>' +
        '<p>The interface starts counting columns and rows at 1. In <code>[4,3,4,2]</code>, Q1 is at (column 1, row 4), Q2 at (2,3), Q3 at (3,4), and Q4 at (4,2). The array index identifies the column; the value identifies the row.</p>' +
        '<p>A <strong>successor</strong>, also called a <strong>neighbor</strong>, is a board reached by moving exactly one queen to another row in its own column. Every other queen stays in place. Moving to the occupied row makes no change, so that matrix cell is marked with a dash.</p>' +
        '<p>A successor is legal for the search representation even if it contains attacks. Local search needs those conflicting states in order to work toward a solution.</p>' +
        '<p>This is <strong>local search</strong>, not Greedy Best-First Search. There is no frontier or search tree. Recorded history helps you study previous states; it does not serve as a frontier or reconstruct a search-tree path.</p>', true),

      topic('2. The heuristic: count attacking pairs once',
        '<p>A <strong>heuristic</strong> is a numerical evaluation used to guide the search. Here it is a <strong>cost</strong>:</p>' +
        '<p class="formula"><code>h(state) = number of attacking queen pairs on the entire board</code></p>' +
        '<p>Lower h is better because fewer pairs attack. The value is a conflict count, not the number of queens in conflict and not a guaranteed number of moves remaining.</p>' +
        '<p>For queens i and j, test whether their rows match, or whether their row distance equals their column distance:</p>' +
        '<p class="formula"><code>same row: row[i] == row[j]</code><br><code>same diagonal: |row[i] − row[j]| == |i − j|</code></p>' +
        '<p>Count each unordered pair once: test only <code>i &lt; j</code>. Column attacks cannot occur because each column has exactly one queen. Evaluate <em>every</em> pair on each candidate board, including pairs that do not involve the moved queen.</p>' +
        '<p><strong>Worked example:</strong> <code>[4,3,4,2]</code> has h = 3. Its attacks are Q1–Q2 (diagonal), Q1–Q3 (same row), and Q2–Q3 (diagonal). For Q2–Q3, <code>|3−4| = |2−3| = 1</code>.</p>' +
        '<p>Moving Q1 to row 1 gives <code>[1,3,4,2]</code> with h = 1. Q2–Q3 still attack, even though Q1 is safe. Q2–Q4 do not attack: <code>|3−2| = 1</code> but <code>|2−4| = 2</code>.</p>' +
        '<p>Because h cannot be negative, any state with <strong>h = 0</strong> is a solved state and a global minimum. If the configuration is infeasible, h = 0 is unattainable and the attained global minimum is positive.</p>'),

      topic('3. How steepest descent chooses the move',
        '<p><strong>Hill climbing</strong> is local search that repeatedly improves the current state using its immediate neighbors. Traditional descriptions often maximize a value; here we minimize a cost, so the movement is <strong>downhill</strong>. Comparing all neighbors is called <strong>steepest descent</strong> in this context.</p>' +
        '<p><strong>Standard steepest-descent hill climbing does not choose a queen first.</strong> It evaluates all one-queen moves, chooses the lowest candidate h, and that candidate determines both the queen and its destination row.</p>' +
        '<ol><li>Start with a complete state and calculate h(current).</li><li>If h(current) = 0, stop: solved.</li><li>Generate every one-queen successor.</li><li>Calculate h for each entire resulting board.</li><li>Find all candidates tied for the minimum h.</li><li>Choose among those candidates using the selected tie rule.</li><li>Move only if the candidate reduces h, or an enabled sideways policy allows equal h.</li><li>Recalculate the current board and repeat.</li></ol>' +
        '<p>The default tie rule selects randomly among equally best successors. “First by column/row” chooses the first in that order. “Student chooses” pauses so you can select one of the best candidates. Ties do not make a worse candidate a standard hill-climbing choice.</p>' +
        '<p>The phase controls separate generation, evaluation, comparison, selection, movement, and re-evaluation so you can inspect how the chosen move arises.</p>'),

      topic('4. State space, successors, and pair tests',
        '<p>These quantities answer different questions. For this ' + r + ' × ' + c + ' board:</p>' +
        '<div class="concept-grid"><p><strong>Total complete states</strong><br><span class="formula">' + r + '<sup>' + c + '</sup> = ' + stateText + '</span><br>Each of the ' + c + ' columns independently chooses one of ' + r + ' rows.</p>' +
        '<p><strong>Successors of one state</strong><br><span class="formula">' + c + ' × (' + r + ' − 1) = ' + successorText + '</span><br>Each queen can move to every row except its current row.</p>' +
        '<p><strong>Pairs checked for one h</strong><br><span class="formula">' + c + ' × (' + c + ' − 1) / 2 = ' + pairText + '</span><br>Each distinct unordered queen pair is checked once.</p>' +
        '<p><strong>Actual h-value</strong><br>The number of those pairs that attack, between 0 and ' + pairText + '. It depends on the arrangement.</p></div>' +
        '<p>For a square N × N board, total states = <strong>N<sup>N</sup></strong>, successors = <strong>N(N−1)</strong>, and pair tests = <strong>N(N−1)/2</strong>.</p>' +
        '<p><strong>4 × 4:</strong> four queens each have three other rows, so 4 × 3 = 12 successors. There are 4<sup>4</sup> = 256 complete states and 6 pairs to check per board.</p>' +
        '<p><strong>8 × 8:</strong> eight queens each have seven other rows, so 8 × 7 = 56 successors. There are 8<sup>8</sup> = 16,777,216 complete states and 28 pairs to check per board.</p>' +
        '<p>One iteration considers the neighbors of one current state; it does not enumerate the whole state space. When there is only one row, there are no alternative-row successors.</p>' + feasibility),

      topic('5. Why the search stops: minima, plateaus, and shoulders',
        '<p>In standard mode with sideways moves off, the rule is <code>best.h &gt;= current.h → STOP</code>. For example, if current h = 1 and best successor h = 1, the best candidate is not smaller. Ordinary hill climbing cannot make an immediately improving move. Stochastic stops when its improving set is empty; first-choice must exhaust the random order before establishing that no improvement exists. Random-restart begins another attempt when its budget permits.</p>' +
        '<ul><li><strong>Strict local minimum:</strong> every neighbor has a larger h. At h &gt; 0, no improving or equal-cost step exists.</li><li><strong>Non-strict local minimum:</strong> no neighbor has a smaller h, and some may have equal h. A tie indicates a flat neighboring region.</li><li><strong>Plateau:</strong> a connected region of states with the same h. Equal neighbors provide evidence of a flat region, but one neighborhood does not reveal the whole region.</li><li><strong>Shoulder:</strong> a plateau with a downhill exit reachable through equal-cost moves. Seeing one equal neighbor is insufficient to prove an exit exists.</li><li><strong>Solved/global minimum:</strong> h = 0. There are no attacking pairs and no smaller possible cost.</li></ul>' +
        '<p>Stopping at h &gt; 0 does not, by itself, show that a global solution does not exist. It shows that this search cannot reach a better state through one immediately improving move. Local search can fail because improvement requires crossing a flat region, temporarily worsening h, or starting elsewhere.</p>' +
        '<p>For an infeasible board, a stopped state could already attain its positive global minimum. The neighborhood check alone cannot prove global optimality.</p>'),

      topic('6. Continue exploring: sideways moves, overrides, and restart',
        '<p><strong>Sideways moves</strong> keep h unchanged. When enabled, an equally best successor may be taken, subject to the maximum consecutive sideways moves. They can cross a plateau or reach a shoulder’s downhill exit, but there is no guarantee.</p>' +
        '<p>Sideways moves are off by default. The default limit is 100 consecutive equal-cost moves. A strictly improving move resets the consecutive count. An unlimited flat walk can revisit states forever; the bound makes the experiment finite.</p>' +
        '<p><strong>Manual override</strong> lets you choose a queen and another row. The displayed destination values evaluate the entire resulting board. A worse move requires the explicit Force Move action after the increase in h is explained. This is an experiment outside the ordinary improving-move rule.</p>' +
        '<p><strong>Random restart</strong> starts hill climbing again from a new complete random state. It can find a different basin of attraction when a previous run becomes stuck. Restart count, iterations in the current restart, total iterations, and best h found help compare attempts.</p>' +
        '<p>Choose Standard, Stochastic, First-Choice, or Random-Restart using the algorithm selector. Stochastic samples the improving set with uniform or improvement-weighted probabilities. First-choice evaluates random candidates lazily and accepts its first strict improvement. Only after exhausting all candidates may it use an allowed equal-cost fallback.</p>' +
        '<p>Random-restart begins with the configured current board, then generates random boards after non-solved stops. Maximum Restarts defaults to 100 new starts after attempt 1. Unlimited until solved removes the restart cap. Neither setting guarantees success in finite time or can solve an infeasible configuration; Pause can stop playback.</p>' +
        '<p>Search statistics count algorithm candidate evaluations separately from inspection and reveal actions. The full-neighborhood reference count indicates how much work evaluating every candidate at each iteration would require.</p>' +
        '<p><strong>Preview and inspection</strong> temporarily show a candidate or historical state without changing the active search. Apply this move or Restore this state explicitly changes it. Return to current state leaves inspection and shows the live board again.</p>')
    ].join('');
  }

  window.QueensLearning = Object.freeze({ render: render, algorithms: algorithms, renderComparison: renderComparison });
})();
