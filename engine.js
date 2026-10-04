/*
 * N-Queens local-search engine. No DOM, imports, network, or dependencies.
 * state[column] = row: columns are zero-based internally; rows are ONE-based.
 * Every heuristic is the cost of the entire board, counting unordered pairs once.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QueensEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function positiveInteger(value, name) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(name + ' must be a positive integer.');
    }
    return value;
  }

  function nonnegativeInteger(value, name) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(name + ' must be a nonnegative integer.');
    }
    return value;
  }

  function validateState(state, rows) {
    if (!Array.isArray(state) || state.length === 0) {
      throw new TypeError('A complete state must contain one row for each column.');
    }
    if (rows !== undefined) positiveInteger(rows, 'Rows');
    state.forEach(function (row, column) {
      positiveInteger(row, 'Row for Q' + (column + 1));
      if (rows !== undefined && row > rows) {
        throw new RangeError('Q' + (column + 1) + ' lies outside the configured rows.');
      }
    });
    return true;
  }

  /* i < j guarantees that a pair is inspected exactly once. */
  function getPairTests(state) {
    validateState(state);
    var tests = [];
    for (var i = 0; i < state.length; i += 1) {
      for (var j = i + 1; j < state.length; j += 1) {
        var sameRow = state[i] === state[j];
        var sameDiagonal = Math.abs(state[i] - state[j]) === j - i;
        tests.push({
          i: i, j: j,
          rowA: state[i], rowB: state[j],
          columnA: i + 1, columnB: j + 1,
          sameRow: sameRow,
          sameDiagonal: sameDiagonal,
          attack: sameRow || sameDiagonal,
          reason: sameRow ? 'same row' : sameDiagonal ? 'same diagonal' : 'no attack'
        });
      }
    }
    return tests;
  }

  function getAttackingPairs(state) {
    return getPairTests(state).filter(function (pair) { return pair.attack; });
  }

  function calculateHeuristic(state) {
    validateState(state);
    var attacks = 0;
    for (var i = 0; i < state.length; i += 1) {
      for (var j = i + 1; j < state.length; j += 1) {
        if (state[i] === state[j] || Math.abs(state[i] - state[j]) === j - i) {
          attacks += 1;
        }
      }
    }
    return attacks;
  }

  /*
   * Generate legal moves WITHOUT calculating any heuristic. First-choice uses
   * this lazy layer, so unvisited neighbors really remain unevaluated.
   */
  function generateMoves(state, rows) {
    if (rows === undefined) rows = state.length;
    validateState(state, rows);
    var successors = [];
    for (var column = 0; column < state.length; column += 1) {
      for (var row = 1; row <= rows; row += 1) {
        if (row === state[column]) continue;
        var candidate = state.slice();
        candidate[column] = row;
        successors.push({
          column: column,
          row: row,
          from: state[column],
          state: candidate
        });
      }
    }
    return successors;
  }

  function evaluateCandidate(candidate) {
    if (!candidate || !Array.isArray(candidate.state)) {
      throw new TypeError('A candidate must contain a complete board state.');
    }
    return Object.assign({}, candidate, {
      state: candidate.state.slice(),
      // Includes conflicts among queens that were NOT moved.
      h: calculateHeuristic(candidate.state)
    });
  }

  /* A successor changes exactly one queen's row; the original is never mutated. */
  function generateSuccessors(state, rows) {
    return generateMoves(state, rows).map(evaluateCandidate);
  }

  /* Fisher–Yates: shuffle a COPY of the array, without evaluating its entries. */
  function shuffleCandidates(candidates, rng) {
    if (!Array.isArray(candidates)) throw new TypeError('Candidates must be an array.');
    if (rng === undefined) rng = Math.random;
    var shuffled = candidates.slice();
    for (var i = shuffled.length - 1; i > 0; i -= 1) {
      var j = Math.floor(randomUnit(rng) * (i + 1));
      var temporary = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = temporary;
    }
    return shuffled;
  }

  function findBestSuccessors(successors) {
    if (!Array.isArray(successors)) throw new TypeError('Successors must be an array.');
    var best = [];
    var bestH = Infinity;
    successors.forEach(function (candidate) {
      nonnegativeInteger(candidate.h, 'Successor h');
      if (candidate.h < bestH) {
        bestH = candidate.h;
        best = [candidate];
      } else if (candidate.h === bestH) {
        best.push(candidate);
      }
    });
    return best;
  }

  function randomUnit(rng) {
    var value = rng();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('Random generator must return a value in [0, 1).');
    }
    return value;
  }

  function randomState(rows, columns, rng) {
    positiveInteger(rows, 'Rows');
    if (columns === undefined) columns = rows;
    positiveInteger(columns, 'Columns');
    if (rng === undefined) rng = Math.random;
    if (typeof rng !== 'function') throw new TypeError('Random generator must be a function.');
    return Array.from({ length: columns }, function () {
      return 1 + Math.floor(randomUnit(rng) * rows);
    });
  }

  function classifyState(state, rows) {
    if (rows === undefined) rows = state.length;
    var successors = generateSuccessors(state, rows);
    var currentH = calculateHeuristic(state);
    return classifyEvaluatedSuccessors(successors, currentH);
  }

  /* Reuse already evaluated boards; never re-evaluate to classify a stop. */
  function classifyEvaluatedSuccessors(successors, currentH) {
    var bestSuccessors = findBestSuccessors(successors);
    var bestH = bestSuccessors.length ? bestSuccessors[0].h : null;
    var kind;
    var explanation;
    if (currentH === 0) {
      kind = 'solved';
      explanation = 'h = 0: no queen pairs attack. Zero is the global minimum of this nonnegative cost.';
    } else if (bestH === null) {
      kind = 'no-successors';
      explanation = 'There is no alternative row, so this state has no successors. Its conflicts cannot be reduced by a within-column move.';
    } else if (bestH < currentH) {
      kind = 'improving';
      explanation = 'An immediately improving move exists: the minimum successor cost ' + bestH + ' is lower than the current cost ' + currentH + '.';
    } else if (bestH > currentH) {
      kind = 'local-minimum';
      explanation = 'Strict local minimum: every immediate successor has higher cost. Current h = ' + currentH + '; best successor h = ' + bestH + '. This alone does not establish whether a solution exists elsewhere.';
    } else {
      kind = 'plateau';
      explanation = 'Equal-cost region: the best successor has h = ' + bestH + ', equal to current h. Standard hill climbing stops because no immediate move improves the cost. Sideways moves may find an exit, but the immediate neighborhood alone cannot establish whether this region is a shoulder.';
    }
    return {
      kind: kind,
      currentH: currentH,
      bestH: bestH,
      bestSuccessors: bestSuccessors,
      successors: successors,
      explanation: explanation
    };
  }

  /*
   * Choose among ALL best boards. This chooses the queen and row together.
   * 'move' is returned only for a decreasing cost or an authorized sideways move.
   * Manual force moves are intentionally handled by the UI, outside this policy.
   */
  function decideMove(state, rows, options) {
    return decideFromClassification(classifyState(state, rows), options);
  }

  function decideFromClassification(classification, options) {
    options = options || {};
    var used = options.sidewaysUsed === undefined ? 0 : options.sidewaysUsed;
    var limit = options.sidewaysLimit === undefined ? 100 : options.sidewaysLimit;
    nonnegativeInteger(used, 'Sideways moves used');
    nonnegativeInteger(limit, 'Sideways move limit');
    var result = Object.assign({}, classification, {
      status: 'stopped',
      move: null,
      moveType: null,
      sidewaysUsed: used,
      nextSidewaysUsed: used,
      sidewaysLimit: limit
    });
    if (classification.kind === 'solved') {
      result.status = 'solved';
      return result;
    }
    if (classification.bestH === null || classification.bestH > classification.currentH) {
      return result;
    }
    var isSideways = classification.bestH === classification.currentH;
    if (isSideways && !options.allowSideways) {
      result.explanation += ' Sideways moves are disabled.';
      return result;
    }
    if (isSideways && used >= limit) {
      result.explanation += ' The maximum of ' + limit + ' consecutive sideways moves has been reached.';
      result.stopReason = 'sideways-limit';
      return result;
    }
    var tieBreak = options.tieBreak || 'random';
    if (['random', 'first', 'manual'].indexOf(tieBreak) === -1) {
      throw new RangeError('Tie break must be random, first, or manual.');
    }
    var best = classification.bestSuccessors;
    var chosen;
    if (tieBreak === 'manual' && best.length > 1) {
      var selected = options.selected || options.selectedCandidate || options.selectedMove;
      chosen = selected && best.find(function (candidate) {
        return candidate.column === selected.column && candidate.row === selected.row;
      });
      if (!chosen) {
        result.status = 'needs-choice';
        result.explanation = 'There are ' + best.length + ' equally best successors with h = ' + classification.bestH + '. Select one of these tied minimum-cost candidates.';
        return result;
      }
    } else if (tieBreak === 'first' || tieBreak === 'manual' || best.length === 1) {
      chosen = best[0];
    } else {
      chosen = best[Math.floor(randomUnit(options.rng || Math.random) * best.length)];
    }
    result.status = 'move';
    result.move = chosen;
    result.moveType = isSideways ? 'sideways' : 'downhill';
    result.nextSidewaysUsed = isSideways ? used + 1 : 0;
    result.explanation = 'Move Q' + (chosen.column + 1) + ' from row ' + chosen.from + ' to row ' + chosen.row + ': h ' + classification.currentH + ' → ' + chosen.h + '. ' + (isSideways ? 'This is an allowed sideways move; consecutive sideways count becomes ' + result.nextSidewaysUsed + '.' : 'This reduces the whole-board cost and resets the consecutive sideways count to zero.');
    return result;
  }

  /*
   * Stochastic hill climbing samples ALL strictly improving neighbors, not just
   * the minimum-cost ties. Optional weights are the decrease in whole-board h.
   * Equality is a fallback only when no strictly improving neighbor exists.
   */
  function getStochasticPool(successors, currentH, options) {
    options = options || {};
    nonnegativeInteger(currentH, 'Current h');
    var used = options.sidewaysUsed === undefined ? 0 : options.sidewaysUsed;
    var limit = options.sidewaysLimit === undefined ? 100 : options.sidewaysLimit;
    nonnegativeInteger(used, 'Sideways moves used');
    nonnegativeInteger(limit, 'Sideways move limit');
    if (!Array.isArray(successors)) throw new TypeError('Successors must be an array.');
    successors.forEach(function (candidate) { nonnegativeInteger(candidate.h, 'Successor h'); });
    if (currentH === 0) return [];
    var eligible = successors.filter(function (candidate) { return candidate.h < currentH; });
    if (eligible.length === 0 && options.allowSideways && used < limit) {
      eligible = successors.filter(function (candidate) { return candidate.h === currentH; });
    }
    var weights = eligible.map(function (candidate) {
      // An equal-cost fallback has zero improvement, so use a uniform weight.
      return options.weighted && candidate.h < currentH ? currentH - candidate.h : 1;
    });
    var totalWeight = weights.reduce(function (sum, weight) { return sum + weight; }, 0);
    return eligible.map(function (candidate, index) {
      return Object.assign({}, candidate, {
        improvement: currentH - candidate.h,
        probability: weights[index] / totalWeight
      });
    });
  }

  function sampleCandidate(pool, rng) {
    if (!Array.isArray(pool)) throw new TypeError('Probability pool must be an array.');
    if (pool.length === 0) return { candidate: null, randomValue: null };
    if (rng === undefined) rng = Math.random;
    var total = pool.reduce(function (sum, candidate) {
      if (!Number.isFinite(candidate.probability) || candidate.probability < 0) {
        throw new RangeError('Candidate probability must be finite and nonnegative.');
      }
      return sum + candidate.probability;
    }, 0);
    if (total <= 0) throw new RangeError('At least one candidate must have positive probability.');
    var randomValue = randomUnit(rng);
    var threshold = randomValue * total;
    var cumulative = 0;
    for (var i = 0; i < pool.length; i += 1) {
      cumulative += pool[i].probability;
      if (threshold < cumulative) return { candidate: pool[i], randomValue: randomValue };
    }
    // Floating-point rounding can place a near-one sample on the final boundary.
    return { candidate: pool[pool.length - 1], randomValue: randomValue };
  }

  /*
   * One PURE iteration for comparisons/tests. The UI uses generateMoves and
   * evaluateCandidate individually to animate each operation. Random-restart
   * uses the standard inner iteration; the UI visibly manages restart attempts.
   * An optional evaluate(candidate) hook supports counting actual evaluations.
   */
  function runVariantIteration(state, rows, options) {
    options = options || {};
    if (rows === undefined) rows = state.length;
    validateState(state, rows);
    var variant = options.variant || options.algorithm || options.mode || 'standard';
    if (variant === 'steepest') variant = 'standard';
    if (variant === 'random-restart') variant = 'restart';
    if (variant === 'firstChoice' || variant === 'firstchoice') variant = 'first-choice';
    if (['standard', 'stochastic', 'first-choice', 'restart'].indexOf(variant) === -1) {
      throw new RangeError('Unknown hill-climbing variant: ' + variant);
    }
    var currentH = calculateHeuristic(state);
    var totalCandidates = state.length * (rows - 1);
    nonnegativeInteger(options.sidewaysUsed === undefined ? 0 : options.sidewaysUsed, 'Sideways moves used');
    nonnegativeInteger(options.sidewaysLimit === undefined ? 100 : options.sidewaysLimit, 'Sideways move limit');
    var trace = [];
    var evaluated = [];
    var rng = options.rng || Math.random;
    var evaluate = options.evaluate || evaluateCandidate;

    function inspect(candidate) {
      var result = evaluate(candidate);
      if (typeof result === 'number') result = Object.assign({}, candidate, { h: result });
      if (!result || !Array.isArray(result.state)) throw new TypeError('The evaluate hook must return a candidate or a numeric h.');
      nonnegativeInteger(result.h, 'Evaluated h');
      evaluated.push(result);
      return result;
    }

    function withMetrics(result, randomizedOrder) {
      return Object.assign({}, result, {
        variant: variant,
        evaluatedCount: evaluated.length,
        totalCandidates: totalCandidates,
        unexaminedCount: totalCandidates - evaluated.length,
        trace: trace,
        randomizedOrder: randomizedOrder || []
      });
    }

    if (currentH === 0) {
      return withMetrics(decideFromClassification(classifyEvaluatedSuccessors([], 0), options));
    }

    var moves = generateMoves(state, rows);
    if (variant === 'first-choice') {
      moves = shuffleCandidates(moves, rng);
      for (var index = 0; index < moves.length; index += 1) {
        var candidate = inspect(moves[index]);
        var accepted = candidate.h < currentH;
        trace.push({
          index: index + 1,
          candidate: candidate,
          accepted: accepted,
          verdict: accepted ? 'accepted' : 'rejected'
        });
        if (accepted) {
          // Do not classifyState here: that would secretly evaluate all neighbors.
          return withMetrics({
            status: 'move', kind: 'improving', move: candidate,
            moveType: 'downhill', currentH: currentH,
            bestH: null, bestSuccessors: [], successors: evaluated.slice(),
            checkedBestH: candidate.h,
            sidewaysUsed: options.sidewaysUsed || 0,
            nextSidewaysUsed: 0,
            sidewaysLimit: options.sidewaysLimit === undefined ? 100 : options.sidewaysLimit,
            explanation: 'Accept the first strict improvement after ' + evaluated.length + ' of ' + totalCandidates + ' candidates: h ' + currentH + ' → ' + candidate.h + '. The remaining candidates were not evaluated, so the global best successor is unknown.'
          }, moves);
        }
      }
      // Exhaustion proves no strict improvement. Then consider the first equal
      // candidate in this random order, only if the sideways setting permits it.
      var exhausted = decideFromClassification(classifyEvaluatedSuccessors(evaluated, currentH), Object.assign({}, options, { tieBreak: 'first' }));
      if (exhausted.move) {
        trace.forEach(function (entry) {
          if (entry.candidate === exhausted.move) {
            entry.accepted = true;
            entry.verdict = 'sideways-fallback';
          }
        });
        exhausted.explanation = 'All ' + totalCandidates + ' candidates were checked without a strict improvement. Take the first equal-cost candidate in the randomized order as an allowed sideways fallback. ' + exhausted.explanation;
      }
      return withMetrics(exhausted, moves);
    }

    moves.forEach(function (move, index) {
      var candidate = inspect(move);
      trace.push({ index: index + 1, candidate: candidate, accepted: false, verdict: 'evaluated' });
    });
    var classification = classifyEvaluatedSuccessors(evaluated, currentH);
    var decision;
    if (variant === 'stochastic') {
      var pool = getStochasticPool(evaluated, currentH, options);
      if (pool.length === 0) {
        decision = decideFromClassification(classification, Object.assign({}, options, { tieBreak: 'first' }));
      } else {
        var sampled = sampleCandidate(pool, rng);
        var chosen = sampled.candidate;
        var isSideways = chosen.h === currentH;
        decision = Object.assign({}, classification, {
          status: 'move', move: chosen,
          moveType: isSideways ? 'sideways' : 'downhill',
          sidewaysUsed: options.sidewaysUsed || 0,
          nextSidewaysUsed: isSideways ? (options.sidewaysUsed || 0) + 1 : 0,
          sidewaysLimit: options.sidewaysLimit === undefined ? 100 : options.sidewaysLimit,
          randomValue: sampled.randomValue,
          explanation: 'Sample one of ' + pool.length + ' eligible candidates with ' + (options.weighted ? 'improvement-weighted' : 'uniform') + ' probability. Chosen h = ' + chosen.h + '; global best h = ' + classification.bestH + '. ' + (isSideways ? 'No strict improvement exists, so this is an allowed sideways fallback.' : 'Stochastic selection may choose a smaller improvement than the global best.')
        });
      }
      decision.probabilities = pool;
      decision.pool = pool;
      decision.improvingCount = evaluated.filter(function (candidate) { return candidate.h < currentH; }).length;
    } else {
      decision = decideFromClassification(classification, options);
    }
    if (decision.move) {
      trace.forEach(function (entry) {
        if (entry.candidate.column === decision.move.column && entry.candidate.row === decision.move.row) {
          entry.accepted = true;
          entry.verdict = 'selected';
        }
      });
    }
    return withMetrics(decision);
  }

  // Each fixed example and each path is checked by selfTests below.
  var PRESETS = [
    {
      id: 'random4', name: 'Random 4 × 4', rows: 4, columns: 4,
      state: [4, 3, 4, 2], random: true,
      description: 'A new complete random state: one queen in every column. Recalculate h rather than assuming a starting cost.'
    },
    {
      id: 'example4', name: 'Whole-board h example', rows: 4, columns: 4,
      state: [4, 3, 4, 2],
      description: 'h = 3. Correct pairs: Q1–Q2 diagonal, Q1–Q3 same row, Q2–Q3 diagonal. Q1 → row 1 leaves Q2–Q3, so that candidate has h = 1.'
    },
    {
      id: 'sequence4', name: 'A downhill path to a solution', rows: 4, columns: 4,
      state: [4, 3, 4, 2],
      path: [[4, 3, 4, 2], [4, 1, 4, 2], [3, 1, 4, 2]],
      pathHeuristics: [3, 1, 0],
      description: 'Verified steepest-descent path: [4,3,4,2] h3 → Q2 row1 → [4,1,4,2] h1 → Q1 row3 → [3,1,4,2] h0. A different tie choice can get stuck; use manual ties to follow this path.'
    },
    {
      id: 'solved4', name: 'Solved 4 × 4', rows: 4, columns: 4,
      state: [2, 4, 1, 3],
      description: 'h = 0. All six unordered queen pairs are safe. [3,1,4,2] is the other solved 4 × 4 state.'
    },
    {
      id: 'stuck4', name: 'Stuck at h = 1', rows: 4, columns: 4,
      state: [1, 3, 4, 2],
      description: 'Current h = 1 and best successor h = 1. Basic hill climbing stops on an equal-cost region. This is a non-strict local minimum, not a strict local minimum.'
    },
    {
      id: 'plateau4', name: 'Sideways move opens a downhill exit', rows: 4, columns: 4,
      state: [3, 4, 2, 1],
      path: [[3, 4, 2, 1], [2, 4, 2, 1], [2, 4, 1, 1], [2, 4, 1, 3]],
      pathHeuristics: [2, 2, 1, 0],
      description: 'Verified path: Q1 row2 keeps h = 2; Q3 row1 lowers h to 1; Q4 row3 solves it. The equal-cost move reaches a state with a downhill exit, demonstrating a shoulder. Other random ties may wander.'
    },
    {
      id: 'strictRectangle', name: 'Strict minimum on a 2 × 4 board', rows: 2, columns: 4,
      state: [2, 2, 1, 1],
      description: 'Current h = 3; successor costs are 5, 4, 4, 5. This is a strict local minimum. Four queens in only two rows cannot be mutually non-attacking, so this rectangular example is unsatisfiable.'
    },
    {
      id: 'plateau8', name: '8 × 8 sideways-limit demonstration', rows: 8, columns: 8,
      state: [2, 5, 8, 6, 4, 3, 1, 8],
      description: 'Current h = 2 and best successor h = 2. Choose Standard mode, first-by-column/row ties, allow sideways, and limit 1. Q3 row8 → row1 keeps h = 2; the new board still has best h = 2, so the next iteration stops at the consecutive sideways limit.'
    },
    {
      id: 'eight', name: 'Standard 8 × 8 Queens', rows: 8, columns: 8,
      state: [1, 2, 3, 4, 5, 6, 7, 8],
      description: 'Start with all eight queens on one diagonal: h = 28, with 56 successors. Compare hill climbing, sideways moves, and random restarts. A verified solution is [1,5,8,6,3,7,2,4].'
    }
  ];

  function getPreset(id) {
    var preset = PRESETS.find(function (item) { return item.id === id; });
    if (!preset) return null;
    return JSON.parse(JSON.stringify(preset));
  }

  /* Independent test oracle: line occupancy counts, NOT the engine's pair loop. */
  function occupancyHeuristic(state) {
    var lines = [new Map(), new Map(), new Map()];
    state.forEach(function (row, column) {
      [row, row - column, row + column].forEach(function (key, index) {
        lines[index].set(key, (lines[index].get(key) || 0) + 1);
      });
    });
    var total = 0;
    lines.forEach(function (map) {
      map.forEach(function (count) { total += count * (count - 1) / 2; });
    });
    return total;
  }

  function sameArray(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function selfTests() {
    var tests = [];
    function check(name, predicate, detail) {
      try {
        var pass = typeof predicate === 'function' ? !!predicate() : !!predicate;
        tests.push({ name: name, pass: pass, detail: detail || (pass ? 'Verified.' : 'Unexpected result.') });
      } catch (error) {
        tests.push({ name: name, pass: false, detail: error.message });
      }
    }
    function throws(fn) { try { fn(); return false; } catch (error) { return true; } }
    var example = [4, 3, 4, 2];
    var successors = generateSuccessors(example, 4);
    var best = findBestSuccessors(successors);

    check('Solved [2,4,1,3] has h = 0', calculateHeuristic([2, 4, 1, 3]) === 0);
    check('Solved [3,1,4,2] has h = 0', calculateHeuristic([3, 1, 4, 2]) === 0);
    check('Solved 8-queens state has h = 0', calculateHeuristic([1, 5, 8, 6, 3, 7, 2, 4]) === 0);
    check('Sample entire-board h = 3', calculateHeuristic(example) === 3);
    check('Candidate retains unmoved queens conflict', calculateHeuristic([1, 3, 4, 2]) === 1);
    check('Four queens on one row count six pairs once', calculateHeuristic([1, 1, 1, 1]) === 6);
    check('Major diagonal attacks', calculateHeuristic([1, 2, 3, 4]) === 6);
    check('Minor diagonal attacks', calculateHeuristic([4, 3, 2, 1]) === 6);
    check('Row attack test', getPairTests([2, 2])[0].sameRow && !getPairTests([2, 2])[0].sameDiagonal);
    check('Diagonal attack test', !getPairTests([1, 2])[0].sameRow && getPairTests([1, 2])[0].sameDiagonal);
    check('Non-attacking pair test', calculateHeuristic([1, 3]) === 0);
    check('Four queens have C(4,2) = 6 pair tests', getPairTests(example).length === 6);
    check('Eight queens have C(8,2) = 28 pair tests', getPairTests([1, 2, 3, 4, 5, 6, 7, 8]).length === 28);
    check('Sample pair identities corrected', sameArray(getAttackingPairs(example).map(function (p) { return [p.i, p.j]; }), [[0, 1], [0, 2], [1, 2]]), 'Q1–Q2 diagonal; Q1–Q3 row; Q2–Q3 diagonal. Q2–Q4 do not attack.');
    check('Pair coordinates use one-based rows and columns', getPairTests(example)[0].columnA === 1 && getPairTests(example)[0].columnB === 2 && getPairTests(example)[0].rowA === 4);
    check('4 × 4 has 12 successors', successors.length === 12);
    check('8 × 8 has 56 successors', generateSuccessors([1, 2, 3, 4, 5, 6, 7, 8], 8).length === 56);
    check('Rectangular successors = columns(rows − 1)', generateSuccessors([1, 2, 3, 1], 3).length === 8);
    check('One-row board has zero successors', generateSuccessors([1, 1, 1], 1).length === 0);
    check('Generate does not mutate current', sameArray(example, [4, 3, 4, 2]));
    check('Every successor changes exactly one queen', successors.every(function (s) { return s.state.filter(function (row, i) { return row !== example[i]; }).length === 1; }));
    check('Candidate states do not alias each other or current', successors.every(function (s, i) { return s.state !== example && successors.every(function (t, j) { return i === j || s.state !== t.state; }); }));
    check('No current-row cell is a successor', successors.every(function (s) { return s.row !== example[s.column]; }));
    check('Successors ordered by column then row', sameArray(successors.map(function (s) { return [s.column, s.row]; }), [[0, 1], [0, 2], [0, 3], [1, 1], [1, 2], [1, 4], [2, 1], [2, 2], [2, 3], [3, 1], [3, 3], [3, 4]]));
    var expectedMatrix = [[1, 1, 2, 5], [4, 2, 4, null], [2, null, 3, 5], [null, 4, null, 5]];
    var actualMatrix = Array.from({ length: 4 }, function () { return [null, null, null, null]; });
    successors.forEach(function (s) { actualMatrix[s.row - 1][s.column] = s.h; });
    check('Entire sample successor matrix', sameArray(actualMatrix, expectedMatrix), 'Rows: [1,1,2,5]; [4,2,4,–]; [2,–,3,5]; [–,4,–,5].');
    check('All minimum ties found', sameArray(best.map(function (s) { return [s.column, s.row, s.h]; }), [[0, 1, 1], [1, 1, 1]]));
    check('Empty successor set has no best', findBestSuccessors([]).length === 0);
    check('Solved state classifies as global minimum', classifyState([2, 4, 1, 3], 4).kind === 'solved');
    check('Improving state classification', classifyState(example, 4).kind === 'improving');
    check('Equal-cost state classification', classifyState([1, 3, 4, 2], 4).kind === 'plateau');
    check('Strict rectangular minimum classification', classifyState([2, 2, 1, 1], 2).kind === 'local-minimum' && classifyState([2, 2, 1, 1], 2).bestH === 4);
    check('No-neighbor unsolved state classification', classifyState([1, 1], 1).kind === 'no-successors');
    check('Single queen is solved', classifyState([1], 1).kind === 'solved');
    check('Basic hill climbing stops at equal h', decideMove([1, 3, 4, 2], 4, { tieBreak: 'first' }).status === 'stopped');
    check('Sideways enabled allows equal h', decideMove([1, 3, 4, 2], 4, { allowSideways: true, tieBreak: 'first' }).moveType === 'sideways');
    check('Sideways count increments', decideMove([1, 3, 4, 2], 4, { allowSideways: true, sidewaysUsed: 9, tieBreak: 'first' }).nextSidewaysUsed === 10);
    check('Sideways limit enforced', decideMove([1, 3, 4, 2], 4, { allowSideways: true, sidewaysUsed: 100 }).stopReason === 'sideways-limit');
    check('Zero sideways budget forbids equal-cost move', decideMove([1, 3, 4, 2], 4, { allowSideways: true, sidewaysLimit: 0 }).status === 'stopped');
    check('Improving move resets consecutive sideways count', decideMove(example, 4, { sidewaysUsed: 99, tieBreak: 'first' }).nextSidewaysUsed === 0);
    check('Algorithm never worsens strict minimum', decideMove([2, 2, 1, 1], 2, { allowSideways: true }).status === 'stopped');
    check('Already solved returns solved without moving', decideMove([3, 1, 4, 2], 4).status === 'solved' && decideMove([3, 1, 4, 2], 4).move === null);
    check('First tie uses column then row', decideMove(example, 4, { tieBreak: 'first' }).move.column === 0);
    check('Manual tie waits for a student choice', decideMove(example, 4, { tieBreak: 'manual' }).status === 'needs-choice');
    check('Manual selected tie is honored', decideMove(example, 4, { tieBreak: 'manual', selected: { column: 1, row: 1 } }).move.column === 1);
    check('Manual mode rejects nonbest candidate', decideMove(example, 4, { tieBreak: 'manual', selected: { column: 0, row: 2 } }).status === 'needs-choice');
    check('Random tie can select first minimum', decideMove(example, 4, { rng: function () { return 0; } }).move.column === 0);
    check('Random tie can select last minimum', decideMove(example, 4, { rng: function () { return 0.999; } }).move.column === 1);
    check('Random state lower endpoint', sameArray(randomState(4, 3, function () { return 0; }), [1, 1, 1]));
    check('Random state upper endpoint', sameArray(randomState(4, 3, function () { return 0.999; }), [4, 4, 4]));
    check('Random state respects rectangular column count', randomState(7, 3).length === 3);
    check('Invalid custom row zero rejected', throws(function () { validateState([0, 1], 4); }));
    check('Out-of-range custom row rejected', throws(function () { generateSuccessors([1, 5], 4); }));
    check('Fractional custom row rejected', throws(function () { calculateHeuristic([1.5, 3]); }));
    check('Empty custom state rejected', throws(function () { calculateHeuristic([]); }));
    check('Invalid random output rejected', throws(function () { randomState(4, 4, function () { return 1; }); }));

    var lazyMoves = generateMoves(example, 4);
    check('Lazy generation returns all 12 legal moves', lazyMoves.length === 12);
    check('Lazy generation calculates no candidate h', lazyMoves.every(function (candidate) { return !Object.prototype.hasOwnProperty.call(candidate, 'h'); }));
    check('Lazy move structures match evaluated successors', sameArray(lazyMoves.map(function (candidate) { return [candidate.column, candidate.row, candidate.from, candidate.state]; }), successors.map(function (candidate) { return [candidate.column, candidate.row, candidate.from, candidate.state]; })));
    check('Single candidate evaluation counts whole board', evaluateCandidate(lazyMoves[0]).h === 1);
    check('Candidate evaluation does not mutate lazy input', !Object.prototype.hasOwnProperty.call(lazyMoves[0], 'h'));
    var shuffledMoves = shuffleCandidates(lazyMoves, function () { return 0; });
    check('Shuffle preserves candidates and count', shuffledMoves.length === 12 && shuffledMoves.every(function (candidate) { return lazyMoves.indexOf(candidate) >= 0; }) && new Set(shuffledMoves).size === 12);
    check('Shuffle leaves source order intact', lazyMoves[0].column === 0 && lazyMoves[0].row === 1 && shuffledMoves !== lazyMoves);
    check('Shuffle actually changes order with deterministic rng', shuffledMoves[0] !== lazyMoves[0]);
    check('Shuffle never evaluates candidate h', shuffledMoves.every(function (candidate) { return !Object.prototype.hasOwnProperty.call(candidate, 'h'); }));

    var synthetic = [{ column: 0, row: 1, h: 4 }, { column: 1, row: 1, h: 3 }, { column: 2, row: 1, h: 1 }, { column: 3, row: 1, h: 5 }, { column: 0, row: 2, h: 6 }];
    var uniform = getStochasticPool(synthetic, 5);
    var weighted = getStochasticPool(synthetic, 5, { weighted: true });
    check('Stochastic pool includes ALL improving candidates', sameArray(uniform.map(function (candidate) { return candidate.h; }), [4, 3, 1]));
    check('Uniform stochastic probabilities exactly 1/3', uniform.every(function (candidate) { return Math.abs(candidate.probability - 1 / 3) < 1e-12; }));
    check('Weighted probability ratio is 1:2:4', sameArray(weighted.map(function (candidate) { return candidate.improvement; }), [1, 2, 4]) && weighted.every(function (candidate, index) { return Math.abs(candidate.probability - [1 / 7, 2 / 7, 4 / 7][index]) < 1e-12; }));
    check('Stochastic pool probabilities normalize', Math.abs(weighted.reduce(function (sum, candidate) { return sum + candidate.probability; }, 0) - 1) < 1e-12);
    check('Stochastic strict improvement outranks equal fallback', getStochasticPool(synthetic, 5, { allowSideways: true }).every(function (candidate) { return candidate.h < 5; }));
    check('Equal stochastic fallback needs sideways enabled', getStochasticPool([{ h: 2 }, { h: 3 }], 2).length === 0);
    check('Weighted equal fallback uses uniform nonzero probabilities', getStochasticPool([{ h: 2 }, { h: 2 }, { h: 3 }], 2, { allowSideways: true, weighted: true }).every(function (candidate) { return candidate.probability === 0.5 && candidate.improvement === 0; }));
    check('Stochastic sideways budget enforced', getStochasticPool([{ h: 2 }], 2, { allowSideways: true, sidewaysUsed: 100 }).length === 0);
    check('Stochastic solved state has no eligibility pool', getStochasticPool([{ h: 0 }], 0, { allowSideways: true }).length === 0);
    check('Sampler first endpoint', sampleCandidate(weighted, function () { return 0; }).candidate.h === 4);
    check('Sampler weighted middle interval', sampleCandidate(weighted, function () { return 0.2; }).candidate.h === 3);
    check('Sampler weighted last interval', sampleCandidate(weighted, function () { return 0.999; }).candidate.h === 1);
    check('Sampler reports the exact random value', sampleCandidate(weighted, function () { return 0.2; }).randomValue === 0.2);
    check('Empty probability pool returns no candidate', sampleCandidate([]).candidate === null);

    var firstChoiceCalls = 0;
    var firstChoice = runVariantIteration([1, 1, 1, 1], 4, {
      variant: 'first-choice', rng: function () { return 0.999; },
      evaluate: function (candidate) { firstChoiceCalls += 1; return evaluateCandidate(candidate); }
    });
    check('First-choice stops immediately after first improving board', firstChoice.status === 'move' && firstChoice.evaluatedCount === 1 && firstChoiceCalls === 1 && firstChoice.trace.length === 1 && firstChoice.unexaminedCount === 11);
    check('First-choice can accept a nonminimum improving board', firstChoice.move.h === 4 && findBestSuccessors(generateSuccessors([1, 1, 1, 1], 4))[0].h === 3);
    check('First-choice does not claim an uncomputed global best', firstChoice.bestH === null && firstChoice.bestSuccessors.length === 0);
    check('First-choice unexamined order entries retain no h', firstChoice.randomizedOrder.every(function (candidate) { return !Object.prototype.hasOwnProperty.call(candidate, 'h'); }));
    var firstStopped = runVariantIteration([1, 3, 4, 2], 4, { variant: 'first-choice', rng: function () { return 0.999; } });
    check('First-choice exhausted scan proves no improvement', firstStopped.status === 'stopped' && firstStopped.evaluatedCount === 12 && firstStopped.kind === 'plateau');
    var firstSideways = runVariantIteration([1, 3, 4, 2], 4, { variant: 'first-choice', allowSideways: true, rng: function () { return 0.999; } });
    check('First-choice equal fallback occurs AFTER full scan', firstSideways.status === 'move' && firstSideways.moveType === 'sideways' && firstSideways.evaluatedCount === 12 && firstSideways.trace.filter(function (entry) { return entry.verdict === 'sideways-fallback'; }).length === 1);
    check('First-choice sideways fallback obeys limit', runVariantIteration([1, 3, 4, 2], 4, { variant: 'first-choice', allowSideways: true, sidewaysUsed: 100 }).status === 'stopped');
    var sideways8 = [2, 5, 8, 6, 4, 3, 1, 8];
    var sideways8Move = decideMove(sideways8, 8, { allowSideways: true, sidewaysLimit: 1, tieBreak: 'first' });
    check('8 × 8 sideways demo begins on a verified plateau', calculateHeuristic(sideways8) === 2 && occupancyHeuristic(sideways8) === 2 && classifyState(sideways8, 8).bestH === 2);
    check('8 × 8 first equal move remains on plateau', sideways8Move.move.column === 2 && sideways8Move.move.row === 1 && sideways8Move.move.h === 2 && classifyState(sideways8Move.move.state, 8).bestH === 2);
    check('8 × 8 limit of one stops the second equal move', decideMove(sideways8Move.move.state, 8, { allowSideways: true, sidewaysLimit: 1, sidewaysUsed: sideways8Move.nextSidewaysUsed, tieBreak: 'first' }).stopReason === 'sideways-limit');
    var standard = runVariantIteration([1, 1, 1, 1], 4, { variant: 'standard', tieBreak: 'first' });
    check('Standard evaluates all candidates and chooses minimum', standard.evaluatedCount === 12 && standard.move.h === 3);
    var stochastic = runVariantIteration([1, 1, 1, 1], 4, { variant: 'stochastic', rng: function () { return 0; } });
    check('Stochastic actually selects nonminimum improvements', stochastic.evaluatedCount === 12 && stochastic.move.h === 4 && stochastic.bestH === 3 && stochastic.randomValue === 0);
    check('Restart inner policy remains steepest descent', runVariantIteration([1, 1, 1, 1], 4, { variant: 'restart', tieBreak: 'first' }).move.h === 3);
    check('All variants short-circuit solved boards without neighbor evaluations', ['standard', 'stochastic', 'first-choice', 'restart'].every(function (variant) {
      var calls = 0;
      var result = runVariantIteration([2, 4, 1, 3], 4, { variant: variant, evaluate: function (candidate) { calls += 1; return evaluateCandidate(candidate); } });
      return result.status === 'solved' && result.evaluatedCount === 0 && calls === 0;
    }));

    PRESETS.forEach(function (preset) {
      check('Preset validates: ' + preset.id, function () { return validateState(preset.state, preset.rows) && preset.state.length === preset.columns && calculateHeuristic(preset.state) === occupancyHeuristic(preset.state); });
      if (preset.path) {
        check('Verified path: ' + preset.id, function () {
          return preset.path.every(function (state, index) {
            if (calculateHeuristic(state) !== preset.pathHeuristics[index]) return false;
            if (index === 0) return sameArray(state, preset.state);
            var previous = preset.path[index - 1];
            var classification = classifyState(previous, preset.rows);
            return classification.bestSuccessors.some(function (s) { return sameArray(s.state, state); }) && calculateHeuristic(state) <= calculateHeuristic(previous);
          }) && calculateHeuristic(preset.path[preset.path.length - 1]) === 0;
        }, 'Every transition moves exactly one queen to a minimum-cost successor; the final board is solved.');
      }
    });

    // Exhaustively check all 4^4 boards and all 256 × 12 candidate board costs.
    var exhaustiveH = true;
    var exhaustiveSuccessors = true;
    var exhaustiveDecision = true;
    var exhaustiveVariants = true;
    var solved = [];
    var counts = { solved: 0, improving: 0, 'local-minimum': 0, plateau: 0 };
    for (var code = 0; code < 256; code += 1) {
      var value = code;
      var state = [];
      for (var column = 0; column < 4; column += 1) {
        state.push(value % 4 + 1);
        value = Math.floor(value / 4);
      }
      var oracleH = occupancyHeuristic(state);
      if (calculateHeuristic(state) !== oracleH) exhaustiveH = false;
      if (oracleH === 0) solved.push(state);
      var generated = generateSuccessors(state, 4);
      if (generated.length !== 12) exhaustiveSuccessors = false;
      generated.forEach(function (candidate) {
        if (candidate.h !== occupancyHeuristic(candidate.state)) exhaustiveSuccessors = false;
        if (candidate.state.filter(function (row, i) { return row !== state[i]; }).length !== 1) exhaustiveSuccessors = false;
      });
      var cls = classifyState(state, 4);
      counts[cls.kind] += 1;
      [false, true].forEach(function (allow) {
        var decision = decideMove(state, 4, { allowSideways: allow, tieBreak: 'first' });
        if (decision.move && (decision.move.h > oracleH || (!allow && decision.move.h >= oracleH))) exhaustiveDecision = false;
      });
      ['standard', 'stochastic', 'first-choice', 'restart'].forEach(function (variant) {
        [false, true].forEach(function (allow) {
          var decision = runVariantIteration(state, 4, { variant: variant, allowSideways: allow, tieBreak: 'first', weighted: true, rng: function () { return 0.25; } });
          if (decision.move && (decision.move.h > oracleH || (!allow && decision.move.h >= oracleH))) exhaustiveVariants = false;
          if (decision.evaluatedCount > 12 || decision.evaluatedCount !== decision.trace.length) exhaustiveVariants = false;
        });
      });
    }
    check('Exhaustive: all 256 whole-board heuristics', exhaustiveH, 'Independent row/diagonal occupancy oracle agrees for every 4 × 4 state.');
    check('Exhaustive: all 3072 successor boards', exhaustiveSuccessors, 'All candidate h-values independently verified; every successor changes exactly one queen.');
    check('Exhaustive: exactly two 4-queens solutions', sameArray(solved.sort(), [[2, 4, 1, 3], [3, 1, 4, 2]].sort()));
    check('Exhaustive: 4 × 4 landscape classification', counts.solved === 2 && counts.improving === 238 && counts.plateau === 16 && counts['local-minimum'] === 0, '2 solved, 238 improving, 16 equal-cost stuck states, 0 strict local minima.');
    check('Exhaustive: 512 decisions never worsen h', exhaustiveDecision, '256 boards × basic and sideways policies.');
    check('Exhaustive: all four variants and sideways settings', exhaustiveVariants, '2048 iterations: no worsening moves, valid evaluation counts, and exact evaluation traces.');
    return tests;
  }

  return {
    version: '1.1.0',
    validateState: validateState,
    getPairTests: getPairTests,
    getAttackingPairs: getAttackingPairs,
    calculateHeuristic: calculateHeuristic,
    generateMoves: generateMoves,
    evaluateCandidate: evaluateCandidate,
    generateSuccessors: generateSuccessors,
    shuffleCandidates: shuffleCandidates,
    findBestSuccessors: findBestSuccessors,
    randomState: randomState,
    classifyState: classifyState,
    decideMove: decideMove,
    getStochasticPool: getStochasticPool,
    sampleCandidate: sampleCandidate,
    runVariantIteration: runVariantIteration,
    PRESETS: PRESETS,
    presets: PRESETS,
    getPreset: getPreset,
    selfTests: selfTests
  };
});
