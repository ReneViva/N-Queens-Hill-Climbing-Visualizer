/* Offline UI and playback controller. The search engine has no DOM dependencies.
 * Search evaluation counts exclude manual previews, reveal-all, and self-tests.
 * First-choice generates unevaluated moves and evaluates them lazily, one by one.
 */
(function () {
  'use strict';
  const E = window.QueensEngine;
  const L = window.QueensLearning;
  const $ = id => document.getElementById(id);
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const arrayText = state => '[' + state.join(', ') + ']';
  const key = move => move.column + ':' + move.row;
  const studyKey = (move,source) => source.join(',')+'|'+key(move);
  const sameState = (a, b) => a.length === b.length && a.every((r, i) => r === b[i]);
  const mode = () => $('algorithm-mode').value;
  const queenSVG = '<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="currentColor"><circle cx="10" cy="15" r="4"/><circle cx="32" cy="9" r="4"/><circle cx="54" cy="15" r="4"/><path d="M10 22 23 31 32 17 41 31 54 22 47 44H17z"/><path d="M17 47h30v5H17zm-3 8h36v5H14z"/></g></svg>';
  let timer = null;
  let cellSignature = '';
  let fastForward = false;
  let model;
  const phaseOrder = ['current','generate','evaluate','compare','select','destination','move','recalculate','loop'];

  function options() {
    return { allowSideways:$('allow-sideways').checked, sidewaysUsed:model.sideways,
      sidewaysLimit:boundedNumber('sideways-limit',0,10000,100), tieBreak:$('tie-break').value,
      weighted:$('stochastic-selection').value === 'weighted' };
  }
  function boundedNumber(id, low, high, fallback) {
    const value = Number($(id).value);
    return Number.isInteger(value) && value >= low && value <= high ? value : fallback;
  }
  function announce(text) { $('action-message').textContent = text; }
  function knownImpossible() {
    return model.columns > model.rows || (model.rows === model.columns && [2,3].includes(model.rows));
  }
  function configWarning() {
    if (model.columns > model.rows) return 'No non-attacking solution exists: there are more queens than rows, so at least two queens must share a row.';
    if (model.rows === model.columns && [2,3].includes(model.rows)) return model.rows + ' × ' + model.columns + ' N-Queens has no non-attacking solution. You can still study its local-search landscape.';
    if (model.rows !== model.columns) return 'Rectangular formulation: one queen per column. The successor count is columns × (rows − 1). A solution is not guaranteed for every shape.';
    return '';
  }
  function newExperiment(state, rows, columns, note) {
    pause(false);
    const initialH = E.calculateHeuristic(state);
    model = {state:state.slice(),initial:state.slice(),rows,columns,phase:'current',ctx:null,
      status:initialH === 0 ? 'solved':'ready',running:false,iteration:0,totalIterations:0,
      algorithmMoves:0,manualMoves:0,sideways:0,restarts:0,stuckAttempts:0,successfulAttempts:initialH === 0 ? 1:0,
      bestH:initialH,bestState:state.slice(),evaluations:0,scans:0,randomSelections:0,
      history:[],selectedColumn:null,candidate:null,view:'current',historyIndex:null,
      studyValues:new Map(),reveal:false,stop:null,countdown:0,manualSelection:false,attemptStuckRecorded:false};
    recordHistory('initial','Initial state');
    $('config-message').className = 'config-message';
    $('config-message').textContent = [note,configWarning()].filter(Boolean).join(' ');
    announce('Experiment ready. Every state has exactly one queen in each column.');
    renderAll();
  }
  function recordHistory(type, description) {
    model.history.push({state:model.state.slice(),h:E.calculateHeuristic(model.state),
      iteration:model.iteration,total:model.totalIterations,restart:model.restarts,type,description,
      trace:model.ctx ? model.ctx.trace.slice() : [],mode:mode(),
      scan:model.ctx ? {source:model.ctx.source.slice(),evaluated:evaluatedList().map(m=>Object.assign({},m)),
        best:model.ctx.best.slice(),pool:model.ctx.pool.slice(),randomValue:model.ctx.randomValue,
        order:model.ctx.order.map(m=>({column:m.column,row:m.row}))} : null});
  }
  function pause(showMessage = true) {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (model) {
      model.running = false;
      if (model.status === 'running') model.status = 'paused';
      if (showMessage) { announce('Paused. Next Step advances one technical operation.'); renderMetrics(); renderControls(); }
    }
  }
  function canRestart() {
    return (mode() === 'restart' || $('auto-restart').checked) && !knownImpossible() &&
      ($('unlimited-restarts').checked || model.restarts < boundedNumber('restart-limit',0,100000,100));
  }
  function play() {
    if (model.status === 'solved') { announce('Solved: h = 0. Reset or generate a new experiment to search again.'); return; }
    if (model.status === 'awaiting_choice') { announce('Choose one of the tied best cells, then press “Choose for algorithm”.'); return; }
    if (model.status === 'stopped' && !canRestart()) { announce('Search is stuck. Enable sideways moves, force a manual move, or restart from a random state.'); return; }
    returnCurrent(false);
    if (!$('auto-run').checked) { nextStep(); return; }
    model.running = true;
    model.status = model.status === 'stopped' ? 'stopped' : 'running';
    renderMetrics(); renderControls(); schedule();
  }
  function schedule() {
    if (!model.running) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!model.running) return;
      nextStep();
      if (model.running) schedule();
    }, 850 / Number($('speed').value));
  }
  function startContext() {
    const source = model.state.slice();
    model.ctx = {source,currentH:E.calculateHeuristic(source),moves:E.generateMoves(source,model.rows),
      evaluated:new Map(),order:[],scanIndex:0,checking:null,firstEqual:null,chosen:null,
      pool:[],best:[],randomValue:null,trace:[],iteration:model.iteration,stopReason:null};
    model.studyValues.clear(); model.reveal = false; model.candidate = null; model.view = 'current'; model.manualSelection = false;
    model.scans += 1;
    if (mode() === 'first-choice') model.ctx.order = E.shuffleCandidates(model.ctx.moves);
  }
  function evaluateMove(move) {
    const candidate = E.evaluateCandidate(move);
    model.ctx.evaluated.set(key(candidate),candidate);
    model.evaluations += 1;
    if(candidate.h<model.bestH) {model.bestH=candidate.h;model.bestState=candidate.state.slice();}
    return candidate;
  }
  function evaluatedList() { return model.ctx ? Array.from(model.ctx.evaluated.values()) : []; }
  function sidewaysAvailable() { const opts = options(); return opts.allowSideways && model.sideways < opts.sidewaysLimit; }
  function makeStop(reason) {
    const ctx = model.ctx;
    const all = evaluatedList();
    const best = E.findBestSuccessors(all);
    const currentH = E.calculateHeuristic(model.state);
    const bestH = best.length ? best[0].h : null;
    const kind = bestH === null ? 'no-successors' : bestH > currentH ? 'local-minimum' : 'plateau';
    model.stop = {kind,currentH,bestH,reason:reason || ((bestH === currentH && $('allow-sideways').checked && !sidewaysAvailable()) ? 'sideways-limit':'no-improvement')};
    if (ctx) ctx.stopReason = model.stop.reason;
    if(!model.attemptStuckRecorded) { model.stuckAttempts += 1; model.attemptStuckRecorded=true; }
    model.status = 'stopped'; model.phase = 'stopped'; model.candidate = null; model.view = 'current'; model.selectedColumn = null;
    recordHistory('stopped','Stopped scan: '+kind+' · current h '+currentH+' · best h '+(bestH??'none'));
    if (!canRestart()) pause(false);
  }
  function markSolved() {
    model.status = 'solved'; model.successfulAttempts = 1; model.stop = null; model.view = 'current';
    pause(false);
    announce('SOLVED' + (model.restarts ? ' AFTER ' + model.restarts + ' RESTARTS' : '') + ' · h = 0 · ' + arrayText(model.state));
  }
  function chooseStandard() {
    const ctx = model.ctx;
    const bestH = ctx.best.length ? ctx.best[0].h : null;
    if (bestH === null || bestH > ctx.currentH || (bestH === ctx.currentH && !sidewaysAvailable())) { makeStop(); return; }
    if ($('tie-break').value === 'manual' && ctx.best.length > 1) {
      model.status = 'awaiting_choice'; model.phase = 'select'; pause(false);
      announce(ctx.best.length + ' successors tie for minimum h = ' + bestH + '. Click one to preview and choose it for the algorithm.');
      return;
    }
    ctx.chosen = $('tie-break').value === 'random' ? ctx.best[Math.floor(Math.random() * ctx.best.length)] : ctx.best[0];
    selectChosen();
  }
  function selectChosen() {
    model.phase = 'select'; model.selectedColumn = model.ctx.chosen.column;
    model.candidate = Object.assign({},model.ctx.chosen,{source:model.ctx.source.slice()});
    model.view = 'current';
    if (model.status !== 'running') model.status = model.running ? 'running':'ready';
  }
  function inspectNext() {
    const ctx = model.ctx;
    ctx.checking = ctx.order[ctx.scanIndex++];
    model.phase = 'inspect'; model.view = 'candidate';
    model.candidate = Object.assign({},ctx.checking,{source:ctx.source.slice(),pending:true});
    model.selectedColumn = null;
  }
  function nextStep() {
    if(model.view==='history') returnCurrent(false);
    if (model.status === 'solved') { renderAll(); return; }
    if (model.status === 'awaiting_choice') { announce('A tied minimum needs your choice before the algorithm can continue.'); return; }
    if (model.phase === 'stopped') {
      if (!canRestart()) { renderAll(); return; }
      model.phase = 'restart-countdown'; model.countdown = 3; model.status = model.running ? 'running':'ready';
      renderAll(); return;
    }
    if (model.phase === 'restart-countdown') {
      model.countdown -= 1;
      if (model.countdown === 0) randomRestart(true);
      else renderAll();
      return;
    }
    const ctx = model.ctx;
    switch (model.phase) {
      case 'current':
        if (E.calculateHeuristic(model.state) === 0) { markSolved(); break; }
        startContext(); model.phase = 'generate'; break;
      case 'generate':
        if (mode() === 'first-choice') {
          if (ctx.order.length) inspectNext(); else makeStop();
        } else {
          ctx.moves.forEach(evaluateMove); model.phase = 'evaluate';
        }
        break;
      case 'inspect':
        ctx.checking = evaluateMove(ctx.checking);
        model.candidate = Object.assign({},ctx.checking,{source:ctx.source.slice()});
        const accepted = ctx.checking.h < ctx.currentH;
        ctx.trace.push({index:ctx.scanIndex,candidate:ctx.checking,accepted,verdict:accepted?'ACCEPTED':'REJECTED'});
        if (ctx.checking.h === ctx.currentH && !ctx.firstEqual) ctx.firstEqual = ctx.checking;
        model.phase = 'judge';
        break;
      case 'judge':
        if (ctx.checking.h < ctx.currentH) { ctx.chosen = ctx.checking; selectChosen(); }
        else if (ctx.scanIndex < ctx.order.length) inspectNext();
        else if (ctx.firstEqual && sidewaysAvailable()) {
          ctx.chosen = ctx.firstEqual;
          const fallbackTrace=ctx.trace.find(t=>key(t.candidate)===key(ctx.firstEqual));
          if(fallbackTrace) { fallbackTrace.accepted=true; fallbackTrace.verdict='SIDEWAYS FALLBACK ACCEPTED'; }
          selectChosen();
        }
        else makeStop();
        break;
      case 'evaluate':
        ctx.best = E.findBestSuccessors(evaluatedList());
        if (mode() === 'stochastic') ctx.pool = E.getStochasticPool(evaluatedList(),ctx.currentH,options());
        model.phase = 'compare'; break;
      case 'compare':
        if (mode() === 'stochastic') {
          if (!ctx.pool.length) makeStop(); else model.phase = 'random-selection';
        } else chooseStandard();
        break;
      case 'random-selection': {
        const sampled = E.sampleCandidate(ctx.pool);
        ctx.chosen = sampled.candidate; ctx.randomValue = sampled.randomValue;
        model.randomSelections += 1; selectChosen(); break;
      }
      case 'select': model.phase = 'destination'; model.view = 'candidate'; break;
      case 'destination':
        commitMove(ctx.chosen,false); model.phase = 'move'; break;
      case 'move':
        model.phase = 'recalculate';
        if (E.calculateHeuristic(model.state) === 0) markSolved();
        break;
      case 'recalculate': model.phase = 'loop'; break;
      case 'loop':
        model.phase = 'current'; model.ctx = null; model.candidate = null; model.view = 'current';
        model.selectedColumn = null; model.studyValues.clear(); model.reveal = false;
        break;
    }
    renderAll();
  }
  function nextIteration() {
    pause(false); returnCurrent(false);
    const initialMoves = model.totalIterations;
    const initialRestarts = model.restarts;
    // At most 3 operations per candidate, plus fixed overhead. No extra move is taken.
    fastForward=true;
    try {
      for (let i=0;i<model.columns*(model.rows-1)*3+30;i++) {
        nextStep();
        if (model.status === 'solved' || model.status === 'awaiting_choice' || model.phase === 'stopped') break;
        if (model.totalIterations > initialMoves) {
          if (model.phase === 'move') nextStep();
          break;
        }
        if (model.restarts > initialRestarts) break;
      }
    } finally {fastForward=false;}
    announce(model.status === 'awaiting_choice' ? 'Choose a tied best successor to complete this iteration.' :
      model.status === 'stopped' ? 'This iteration stopped: no allowed improving move exists.' : 'One iteration completed. Its evaluated candidates remain visible in the matrix.');
    renderAll();
  }
  function commitMove(move, manual) {
    const oldH = E.calculateHeuristic(model.state);
    model.state = move.state.slice();
    const h = E.calculateHeuristic(model.state);
    model.sideways = h === oldH ? model.sideways+1 : 0;
    model.iteration += 1; model.totalIterations += 1;
    if (manual) model.manualMoves += 1; else model.algorithmMoves += 1;
    if (h < model.bestH) { model.bestH = h; model.bestState = model.state.slice(); }
    const type = manual ? 'manual' : h === oldH ? 'sideways':'downhill';
    recordHistory(type,'Q'+(move.column+1)+' row '+move.from+' → '+move.row+' · h '+oldH+' → '+h);
    model.candidate = null; model.view = 'current'; model.historyIndex = null; model.selectedColumn = null; model.manualSelection = false;
    if (manual) {
      model.ctx = null; model.phase = 'current'; model.stop = null; model.status = h === 0 ? 'solved':'ready';
      model.selectedColumn = null; model.studyValues.clear(); model.reveal = false;
      if (h === 0) markSolved();
    }
  }
  function applyMove(force) {
    const candidate = model.candidate;
    if (!candidate || candidate.pending || !sameState(candidate.source,model.state)) { announce('This is an inspected earlier state. Return to current state before applying a move.'); return; }
    const oldH = E.calculateHeuristic(model.state);
    if (candidate.h > oldH && !force) { announce('This increases h. Read the explanation, then use Force Move to override hill climbing.'); return; }
    pause(false); commitMove(candidate,true);
    announce('Manual override applied: h '+oldH+' → '+candidate.h+'. The next search iteration begins from this complete state.');
    renderAll();
  }
  function randomRestart(fromPlayback = false) {
    const wasRunning = model.running;
    if (!fromPlayback) pause(false);
    model.restarts += 1; model.iteration = 0; model.sideways = 0;
    model.attemptStuckRecorded=false;
    model.state = E.randomState(model.rows,model.columns);
    const h = E.calculateHeuristic(model.state);
    if (h < model.bestH) { model.bestH = h; model.bestState = model.state.slice(); }
    model.ctx = null; model.phase = 'current'; model.stop = null; model.status = 'ready';
    model.view = 'current'; model.candidate = null; model.selectedColumn = null;
    model.historyIndex = null; model.studyValues.clear(); model.reveal = false;
    recordHistory('restart','Random restart #'+model.restarts);
    if (h === 0) markSolved(); else if (fromPlayback && wasRunning) { model.running=true; model.status='running'; }
    announce((h===0?'SOLVED AFTER '+model.restarts+' RESTARTS':'RANDOM RESTART #'+model.restarts)+' · new state '+arrayText(model.state)+' · h = '+h);
    renderAll();
  }
  function resetSearch() { newExperiment(model.initial,model.rows,model.columns,'Reset to the initial state. All counters and playback have been reset.'); }
  function invalidateSearch(message) {
    pause(false); model.ctx = null; model.phase = 'current'; model.stop = null;
    model.status = E.calculateHeuristic(model.state) === 0 ? 'solved':'ready';
    model.view = 'current'; model.candidate = null; model.selectedColumn = null;
    model.studyValues.clear(); model.reveal = false;
    announce(message); renderAll();
  }
  function getMatrixBase() { return model.ctx ? model.ctx.source : model.state; }
  function availableMoves() { return model.ctx ? model.ctx.moves : E.generateMoves(model.state,model.rows); }
  function inspectCandidate(column,row,currentBoard=false) {
    pause(false);
    const source = currentBoard ? model.state : getMatrixBase();
    if (source[column] === row) return;
    const move = E.generateMoves(source,model.rows).find(m => m.column === column && m.row === row);
    const candidate = E.evaluateCandidate(move);
    model.studyValues.set(studyKey(candidate,source),candidate);
    model.candidate = Object.assign({},candidate,{source:source.slice()});
    model.view = 'candidate'; model.historyIndex = null;
    announce('Preview only: the actual current state has not changed.');
    renderAll();
  }
  function hoverCandidate(column,row) {
    const move = availableMoves().find(m => m.column === column && m.row === row);
    if (!move) return;
    const known = model.ctx?.evaluated.get(key(move)) || model.studyValues.get(studyKey(move,getMatrixBase()));
    // First-choice hover never evaluates hidden values; explicit click is a study action.
    const candidate = known || (mode() !== 'first-choice' ? E.evaluateCandidate(move) : Object.assign({},move,{pending:true}));
    renderCandidate(Object.assign({},candidate,{source:getMatrixBase().slice()}),true);
  }
  function returnCurrent(doRender = true) {
    model.view = 'current'; model.historyIndex = null;
    if (!model.ctx?.chosen || ['move','recalculate','loop'].includes(model.phase)) model.candidate = null;
    if (doRender) { announce('Showing the actual current state.'); renderAll(); }
  }
  function inspectHistory(index) {
    pause(false); model.historyIndex = index; model.view = 'history'; model.selectedColumn = null; model.candidate = null;
    announce('History inspection only. Use Restore this state to change the search state.'); renderAll();
  }
  function restoreHistory() {
    if (model.historyIndex === null) return;
    const entry = model.history[model.historyIndex];
    model.state = entry.state.slice(); model.ctx = null; model.phase = 'current'; model.sideways = 0;
    model.stop = null; model.status = entry.h === 0 ? 'solved':'ready';
    model.candidate = null; model.view = 'current'; model.historyIndex = null; model.studyValues.clear();
    recordHistory('restore','Restored a historical board; counters retained for this experiment.');
    announce('Historical board restored. History and experiment totals are retained; sideways streak reset.'); renderAll();
  }
  function displayState() {
    if (model.view === 'history' && model.historyIndex !== null) return model.history[model.historyIndex].state;
    if (model.view === 'candidate' && model.candidate) return model.candidate.state;
    return model.state;
  }
  function displayPending() { return model.view === 'candidate' && model.candidate?.pending; }
  function renderBoard() {
    const state = displayState();
    const pending = displayPending();
    const attacks = pending ? [] : E.getAttackingPairs(state);
    const conflicted = new Set(attacks.flatMap(p=>[p.i,p.j]));
    const showCoords = $('show-coords').checked;
    const size = Math.max(model.rows,model.columns);
    $('board').style.setProperty('--board-ratio',model.columns+'/'+model.rows);
    document.querySelector('.board-shell').style.maxWidth=model.rows>model.columns?(540*model.columns/model.rows+24)+'px':'';
    $('board').style.setProperty('--queen-font',Math.max(6,Math.min(12,90/size))+'px');
    $('board-cells').style.gridTemplateColumns = 'repeat('+model.columns+',1fr)';
    $('board-cells').style.gridTemplateRows = 'repeat('+model.rows+',1fr)';
    const columnLabels = $('column-labels'); const rowLabels = $('row-labels');
    columnLabels.style.gridTemplateColumns='repeat('+model.columns+',1fr)';
    rowLabels.style.gridTemplateRows='repeat('+model.rows+',1fr)';
    columnLabels.innerHTML=Array.from({length:model.columns},(_,c)=>'<span>'+ (c+1) +'</span>').join('');
    rowLabels.innerHTML=Array.from({length:model.rows},(_,r)=>'<span>'+ (r+1) +'</span>').join('');
    columnLabels.style.visibility=rowLabels.style.visibility=showCoords?'visible':'hidden';
    const signature=[model.rows,model.columns,model.selectedColumn,model.view,model.state.join(','),$('show-heuristics').checked,model.manualSelection,model.phase].join('|');
    if (signature !== cellSignature) {
      cellSignature=signature;
      let html='';
      for(let r=1;r<=model.rows;r++) for(let c=0;c<model.columns;c++) {
        const destination = model.selectedColumn===c && model.view==='current' && model.state[c]!==r;
        let label='';
        if(destination && $('show-heuristics').checked) {
          const cached=(model.ctx&&sameState(model.ctx.source,model.state)?model.ctx.evaluated.get(c+':'+r):null)||model.studyValues.get(studyKey({column:c,row:r},model.state));
          let destinationH=cached?.h??'?';
          if(mode()!=='first-choice'||model.manualSelection) {
            const temporary=model.state.slice(); temporary[c]=r;
            destinationH=E.calculateHeuristic(temporary);
          }
          label='<span class="cell-h">'+destinationH+'</span>';
        }
        html+='<button class="board-cell '+((r+c)%2===0?'light-cell ':'')+(destination?'destination':'')+'" data-column="'+c+'" data-row="'+r+'" aria-label="Column '+(c+1)+', row '+r+(destination?', preview destination':'')+'" tabindex="'+(destination?'0':'-1')+'">'+label+'</button>';
      }
      $('board-cells').innerHTML=html;
    }
    const layer=$('queen-layer');
    while(layer.children.length>model.columns) layer.lastChild.remove();
    for(let c=0;c<model.columns;c++) {
      let queen=layer.children[c];
      if(!queen) { queen=document.createElement('button'); queen.className='queen'; queen.innerHTML=queenSVG+'<span></span>'; layer.appendChild(queen); }
      queen.dataset.column=c;
      queen.style.width=(100/model.columns)+'%'; queen.style.height=(100/model.rows)+'%';
      queen.style.left=(c*100/model.columns)+'%'; queen.style.top=((state[c]-1)*100/model.rows)+'%';
      queen.style.transitionDuration=(450/Number($('speed').value))+'ms';
      queen.className='queen'+(conflicted.has(c)?' conflicted':'')+(model.selectedColumn===c?' selected':'')+(model.view==='candidate'&&model.candidate?.column===c?' candidate-queen':'');
      queen.querySelector('span').textContent='Q'+(c+1);
      queen.querySelector('span').hidden=!$('show-ids').checked;
      queen.setAttribute('aria-label','Queen '+(c+1)+', column '+(c+1)+', row '+state[c]+(conflicted.has(c)?', in conflict':''));
      const related=attacks.filter(p=>p.i===c||p.j===c).map(p=>'Q'+((p.i===c?p.j:p.i)+1)+': '+p.reason);
      queen.title='Q'+(c+1)+' = (column '+(c+1)+', row '+state[c]+'). '+(related.length?'Attacks '+related.join('; ')+'. ':'Safe in this displayed board. ')+'Click to inspect destinations.';
    }
    $('attack-lines').innerHTML = $('show-lines').checked ? attacks.map(p=>'<line x1="'+((p.i+.5)*100/model.columns)+'" y1="'+((p.rowA-.5)*100/model.rows)+'" x2="'+((p.j+.5)*100/model.columns)+'" y2="'+((p.rowB-.5)*100/model.rows)+'"><title>Q'+(p.i+1)+' ↔ Q'+(p.j+1)+': '+esc(p.reason)+'</title></line>').join('') : '';
    $('board-size').textContent=model.rows+' × '+model.columns;
    $('state-array').textContent=arrayText(state);
    $('state-display-label').textContent=model.view==='current'?'CURRENT STATE':model.view==='history'?'INSPECTED HISTORY STATE':'CANDIDATE STATE · PREVIEW';
    $('display-h').textContent=pending?'h = ? (pending)':'h = '+E.calculateHeuristic(state);
    $('view-banner').hidden=model.view==='current';
    $('view-banner').className='view-banner'+(model.view==='history'?' history':'');
    $('view-banner').textContent=model.view==='history'?'History inspection · actual search state unchanged':pending?'Checking candidate · heuristic has not been evaluated yet':'Candidate preview · actual current state unchanged';
    $('board-help').textContent=model.selectedColumn!==null&&model.view==='current'?'Q'+(model.selectedColumn+1)+' selected. Click a highlighted destination to preview its whole-board cost.':'Click a queen to inspect every destination in its column.';
  }
  function renderMetrics() {
    const h=E.calculateHeuristic(model.state);
    $('current-h').textContent=h; $('h-caption').textContent=h===1?'attacking pair':'attacking pairs';
    $('iteration-value').textContent=model.iteration;
    $('total-iterations').textContent=model.totalIterations+' total moves';
    $('sideways-value').innerHTML=model.sideways+' <small>/ '+options().sidewaysLimit+'</small>';
    $('restart-value').textContent=model.restarts; $('best-ever').textContent=model.bestH;
    const names={ready:'Ready',running:'Playing',paused:'Paused',stopped:'Stopped',solved:'Solved',awaiting_choice:'Choose a tie'};
    $('status-badge').className='status '+model.status;
    $('status-badge').textContent=names[model.status]||model.status;
    $('status-subtext').textContent=model.status==='solved'?'Global minimum · no attacking pairs':model.status==='stopped'?'No allowed improving move':model.status==='awaiting_choice'?'Choose one of the best cells':(L.algorithms?.[mode()]?.name||'Inspect the next operation');
  }
  function renderControls() {
    $('pause').disabled=!model.running;
    $('start').disabled=model.running||model.status==='solved'||model.status==='awaiting_choice';
    $('next-phase').disabled=model.running||model.status==='solved';
    $('next-iteration').disabled=model.running||model.status==='solved';
    $('previous').disabled=model.history.length<2;
    $('restore-history').hidden=model.view!=='history';
    $('return-history').hidden=model.view!=='history';
  }
  function phaseInformation() {
    const ctx=model.ctx, h=E.calculateHeuristic(model.state), total=model.columns*(model.rows-1);
    const move=ctx?.chosen;
    const moveLabel=move?'Q'+(move.column+1)+' → row '+move.row:'';
    const info={
      current:['CURRENT STATE','Start with a complete state','Current = '+arrayText(model.state)+'. h = '+h+'. Exactly one queen occupies every column.'],
      generate:['GENERATE','Generate legal one-queen moves',model.columns+' × ('+model.rows+' − 1) = '+total+' successors. '+(mode()==='first-choice'?'Shuffle their order without calculating their h-values.':'Each candidate moves one queen within its column; every other queen remains in place.')],
      evaluate:['CALCULATE','Calculate total h for every candidate','For each temporary board, examine all '+(model.columns*(model.columns-1)/2)+' unordered queen pairs. All '+total+' candidates have now been evaluated.'],
      compare:['COMPARE',mode()==='stochastic'?'Build the probability pool':'Find the smallest successor h',mode()==='stochastic'?(ctx?.pool.length||0)+' eligible moves. '+($('stochastic-selection').value==='weighted'?'Weight each strict improvement by current h − candidate h.':'Every eligible move has equal probability.')+' A random choice can have a higher cost than the global best neighbor.':'Lowest candidate h = '+(ctx?.best[0]?.h??'none')+'. '+(ctx?.best.length||0)+' candidate(s) share this minimum. Compare it with current h = '+(ctx?.currentH??h)+'.'],
      'random-selection':['RANDOM DRAW','Random selection…','The probability pool is visible. The next operation draws one random value in [0,1) and selects the corresponding cumulative probability interval.'],
      inspect:['CHECKING','Inspect candidate #'+(ctx?.scanIndex||1),'Preview the next board in the shuffled order. Its h is still unknown. Calculate all of its pairs in the next operation.'],
      judge:['TEST',ctx?.checking?.h<(ctx?.currentH??0)?'ACCEPTED · first improvement':'REJECTED · try another candidate',ctx?.checking?'Candidate '+ctx.scanIndex+': Q'+(ctx.checking.column+1)+' → row '+ctx.checking.row+' has h = '+ctx.checking.h+'. '+(ctx.checking.h<ctx.currentH?'It is strictly better than '+ctx.currentH+'. Stop scanning immediately; untested neighbors remain unknown.':'It does not improve h = '+ctx.currentH+'. Equal moves are kept as fallback only after all candidates fail to improve.'):'No candidate has been tested.'],
      select:['SELECT QUEEN','Select '+(move?'Queen '+(move.column+1):'a tied best successor'),move?moveLabel+' yields h = '+move.h+'. '+(move.h===ctx.currentH?'This is a sideways move.':'This reduces the whole-board cost.')+(mode()==='stochastic'&&ctx.randomValue!==null?' Random value = '+ctx.randomValue.toFixed(6)+'.':''):'Click a highlighted minimum-cost matrix cell, then Choose for algorithm.'],
      destination:['SELECT DESTINATION','Highlight destination row '+(move?.row??''),moveLabel+'. The board is a candidate preview. Current is still '+arrayText(model.state)+'.'],
      move:['MOVE','Commit the chosen complete board','New current = '+arrayText(model.state)+'. Queen movement is animated; this transition is recorded in history.'],
      recalculate:['RECALCULATE','Recalculate current h','h = '+h+'. '+(h===0?'No pair attacks. The global minimum is reached.':'Continue from this board, with a newly generated neighborhood.')],
      loop:['LOOP','Begin the next iteration','Discard the old successor list. Generate the neighbors of the new current board; old candidate costs are not reused.'],
      stopped:['STOP','Hill climbing stopped','No allowed move can reduce the current cost. Read the stopping analysis below.'],
      'restart-countdown':['RESTART','Random restart in '+model.countdown+'…','Attempt '+(model.restarts+1)+' was stuck. Start attempt '+(model.restarts+2)+' with a new random complete state. The best board and all previous history are retained.']
    };
    return info[model.phase]||info.current;
  }
  function renderDebugger() {
    const info=phaseInformation(),ctx=model.ctx;
    const index=phaseOrder.indexOf(model.phase);
    $('phase-counter').textContent=mode()==='first-choice'?'Check '+(ctx?.scanIndex||0)+' / '+(ctx?.moves.length||model.columns*(model.rows-1)):(Math.max(0,index)+1)+' / 9';
    $('phase-track').innerHTML=phaseOrder.map((_,i)=>'<span class="phase-step '+(i===index?'active':i<index?'done':'')+'"></span>').join('');
    $('phase-eyebrow').textContent=info[0]; $('phase-title').textContent=info[1]; $('phase-description').textContent=info[2];
    const meta=L.algorithms?.[mode()];
    const code=(meta?.pseudocode||['current = initial_state','while current.h > 0:','    successors = generate_all(current)','    evaluate_all(successors)','    best = minimum(successors)','    if best.h >= current.h: stop','    current = best']).slice();
    if ($('allow-sideways').checked) code.push('# equality fallback only within sideways budget');
    const codeMap={
      standard:{current:0,generate:2,evaluate:3,compare:4,select:7,destination:8,move:9,recalculate:10,loop:1,stopped:5},
      stochastic:{current:0,generate:2,evaluate:3,compare:4,'random-selection':8,select:9,destination:9,move:10,recalculate:11,loop:1,stopped:6},
      'first-choice':{current:0,generate:2,inspect:5,judge:7,select:13,destination:13,move:14,recalculate:15,loop:1,stopped:12},
      restart:{current:0,generate:3,evaluate:4,compare:5,select:7,destination:7,move:8,recalculate:9,loop:2,stopped:11,'restart-countdown':13}
    };
    let active=codeMap[mode()][model.phase]??-1;
    if(model.status==='solved') active={standard:11,stochastic:12,'first-choice':16,restart:10}[mode()];
    else if(model.status==='awaiting_choice') active=mode()==='standard'?6:7;
    $('pseudocode').innerHTML=code.map((line,i)=>'<div class="code-line '+(i===active?'active':'')+'"><span class="line-number">'+(i+1)+'</span><code>'+esc(line)+'</code></div>').join('');
    const vars=[['algorithm_mode',mode()],['current_state',arrayText(model.state)],['current_h',E.calculateHeuristic(model.state)],['iteration',model.iteration],['status',model.status]];
    if(mode()==='first-choice') vars.push(['total_possible_successors',model.columns*(model.rows-1)],['randomized_order',ctx?ctx.order.map(m=>ctx.moves.indexOf(m)+1).join(' → '):'—'],['candidate_index',ctx?.scanIndex||0],['candidates_checked',ctx?.evaluated.size||0],['current_candidate_h',ctx?.checking?.h??'?'],['accepted',ctx?.chosen?'true':ctx?.checking?.h!==undefined?String(ctx.checking.h<ctx.currentH):'—']);
    else vars.push(['successor_count',ctx?.moves.length??'not generated'],['best_h',ctx?.best[0]?.h??'—'],['best_successors',ctx?.best.map(m=>'Q'+(m.column+1)+'→R'+m.row).join(', ')||'—']);
    if(mode()==='stochastic') vars.push(['improving_successor_count',ctx?.pool.filter(m=>m.h<ctx.currentH).length||0],['candidate_probabilities',ctx?.pool.map(m=>'Q'+(m.column+1)+'R'+m.row+':'+(m.probability*100).toFixed(1)+'%').join(' ')||'—'],['random_value',ctx?.randomValue?.toFixed(6)??'not drawn'],['chosen_successor',ctx?.chosen?arrayText(ctx.chosen.state):'—']);
    vars.push(['chosen_queen',ctx?.chosen?'Q'+(ctx.chosen.column+1):'—'],['chosen_row',ctx?.chosen?.row??'—']);
    if(mode()==='restart') vars.push(['restart_number',model.restarts],['iteration_in_restart',model.iteration],['total_iterations',model.totalIterations],['best_h_ever',model.bestH],['best_state_ever',arrayText(model.bestState)],['restart_limit',$('unlimited-restarts').checked?'unlimited':boundedNumber('restart-limit',0,100000,100)]);
    $('debug-variables').innerHTML=vars.map(([name,value])=>'<dt>'+esc(name)+'</dt><dd>'+esc(value)+'</dd>').join('');
    const flow=meta?.flow||['Current','Generate','Evaluate','Compare','Move','Repeat'];
    const flowMap={
      standard:{current:0,generate:1,evaluate:2,compare:3,select:5,destination:6,move:7,recalculate:8,loop:8,stopped:4,'restart-countdown':8},
      stochastic:{current:0,generate:1,evaluate:2,compare:4,'random-selection':5,select:5,destination:6,move:7,recalculate:8,loop:8,stopped:3,'restart-countdown':8},
      'first-choice':{current:0,generate:1,inspect:2,judge:4,select:5,destination:6,move:7,recalculate:8,loop:8,stopped:4,'restart-countdown':8},
      restart:{current:0,generate:1,evaluate:2,compare:3,select:5,destination:6,move:7,recalculate:8,loop:8,stopped:4,'restart-countdown':8}
    };
    const flowIndex=model.status==='solved'?8:flowMap[mode()][model.phase]??0;
    $('algorithm-flow').innerHTML=flow.map((node,i)=>(i?'<span class="flow-arrow">→</span>':'')+'<span class="flow-node '+(i===Math.min(flowIndex,flow.length-1)?'active':'')+'">'+esc(node)+'</span>').join('');
    renderStop();
  }
  function renderStop() {
    const panel=$('stop-explanation');
    panel.hidden=!model.stop&&model.status!=='solved'; panel.className='stop-explanation'+(model.status==='solved'?' solved':'');
    if(model.status==='solved') { panel.innerHTML='<strong>SOLVED · GLOBAL MINIMUM REACHED</strong><p>h = 0. No queen pair attacks another.</p><p>'+esc(arrayText(model.state))+'</p><p>'+model.totalIterations+' moves · '+model.evaluations+' candidate boards evaluated · '+model.restarts+' restarts.</p>'; return; }
    if(!model.stop) return;
    const s=model.stop;
    const title=s.reason==='sideways-limit'?'SIDEWAYS MOVE LIMIT REACHED':s.kind==='local-minimum'?'HILL CLIMBING STOPPED · LOCAL MINIMUM':s.kind==='no-successors'?'HILL CLIMBING STOPPED · NO SUCCESSORS':'HILL CLIMBING STOPPED · PLATEAU / POSSIBLE SHOULDER';
    const details=s.kind==='local-minimum'?'Every immediate successor has a higher cost: this is a strict local minimum.':s.kind==='no-successors'?'Only one row exists. There is no within-column move to make.':'No lower-cost neighbor exists, but equal-cost neighbors do. The immediate neighborhood cannot prove whether this flat region has a downhill exit (a shoulder).';
    panel.innerHTML='<strong>'+title+'</strong><p>Current h = '+s.currentH+'; best successor h = '+(s.bestH??'none')+'.</p>'+(s.bestH!==null?'<div class="formula">'+s.bestH+' ≥ '+s.currentH+' → no strict improvement</div>':'')+'<p>'+details+'</p><p>'+(knownImpossible()?'This board shape is known to have no non-attacking solution.': 'This does not mean a global solution does not exist. Search cannot reach a better board using one immediately improving move.')+'</p>'+(s.reason==='sideways-limit'?'<p>The consecutive limit prevents indefinite cycling on a flat region.</p>':'')+'<p>'+(canRestart()?'The next step begins a visible random-restart transition.':knownImpossible()?'Automatic restarts are disabled for this known impossible shape.':(mode()==='restart'||$('auto-restart').checked)?'The restart limit is reached. Increase the limit or restart manually.':'Try bounded sideways moves, a manual override, or a random restart.')+'</p>';
  }
  function renderSuccessorMatrix() {
    const base=getMatrixBase(), moves=availableMoves(),ctx=model.ctx;
    const lookup=new Map(moves.map(m=>[key(m),m]));
    const bestH=ctx?.best[0]?.h;
    const poolMap=new Map((ctx?.pool||[]).map(m=>[key(m),m]));
    let html='<thead><tr><th scope="col">Row</th>'+base.map((_,c)=>'<th scope="col">Q'+(c+1)+'</th>').join('')+'</tr></thead><tbody>';
    for(let r=1;r<=model.rows;r++) {
      html+='<tr><td>'+r+'</td>';
      for(let c=0;c<model.columns;c++) {
        const m=lookup.get(c+':'+r);
        if(!m) { html+='<td class="no-move" title="Queen already occupies this row">—</td>'; continue; }
        const tested=ctx?.evaluated.get(key(m));
        const revealed=model.studyValues.get(studyKey(m,base));
        const shown=tested||revealed;
        const currentH=ctx?.currentH??E.calculateHeuristic(base);
        let cls=shown?(shown.h<currentH?'improving':shown.h===currentH?'equal':''):'untested';
        if(mode()==='stochastic'&&ctx?.pool.length) cls+=poolMap.has(key(m))?' minimum':' rejected';
        else if(bestH!==undefined&&tested?.h===bestH&&mode()!=='first-choice') cls+=' minimum';
        if(mode()==='first-choice'&&tested) cls+=tested.h<currentH||(ctx?.chosen&&key(ctx.chosen)===key(m))?' accepted':' rejected';
        if(ctx?.checking&&key(ctx.checking)===key(m)&&model.phase==='inspect') cls+=' checking';
        if(model.candidate&&sameState(model.candidate.source,base)&&key(model.candidate)===key(m)) cls+=' selected';
        const probability=poolMap.get(key(m))?.probability;
        html+='<td><button class="'+cls+'" data-column="'+c+'" data-row="'+r+'" title="Move Q'+(c+1)+' to row '+r+'. '+(shown?'Entire-board h = '+shown.h+(tested?' (algorithm evaluated)':' (study reveal)'):'Not evaluated by the algorithm. Click for a study preview.')+'" aria-label="Q'+(c+1)+' to row '+r+', '+(shown?'h '+shown.h:'untested')+'">'+(shown?shown.h:'?')+(probability!==undefined?'<span class="probability">'+(probability*100).toFixed(1)+'%</span>':'')+'</button></td>';
      }
      html+='</tr>';
    }
    $('successor-matrix').innerHTML=html+'</tbody>';
    $('successor-count').textContent=moves.length+' moves';
    $('matrix-context').textContent='Attempt '+(model.restarts+1)+' · source '+arrayText(base)+(sameState(base,model.state)?'':' · previous iteration neighborhood');
    $('scan-progress').textContent='Candidates checked this iteration: '+(ctx?.evaluated.size||0)+' / '+moves.length;
    $('best-summary').innerHTML=mode()==='first-choice'?'<strong>'+(ctx?.chosen?'First accepted move: Q'+(ctx.chosen.column+1)+' → row '+ctx.chosen.row+' · h = '+ctx.chosen.h:'First improvement wins')+'</strong><small>Unexamined costs stay hidden. Reveal-all is a separate learning operation.</small>':mode()==='stochastic'?'<strong>'+(ctx?.pool.length?ctx.pool.length+' eligible moves · '+$('stochastic-selection').value+' selection':'Strict improvements form the probability pool')+'</strong><small>Random choice can differ from the minimum-cost neighbor.</small>':'<strong>'+(ctx?.best.length?'Minimum h = '+ctx.best[0].h+' · '+ctx.best.length+' best candidate(s)':'Generate → evaluate → compare all successors')+'</strong><small>The winning board determines the queen and its destination together.</small>';
    renderRandomness();
  }
  function renderRandomness() {
    const ctx=model.ctx,panel=$('randomness-panel');
    panel.hidden=!ctx||!['stochastic','first-choice'].includes(mode());
    panel.className='randomness-panel'+(model.phase==='random-selection'?' drawing':'');
    if(panel.hidden) return;
    if(mode()==='first-choice') {
      const order=ctx.order.map(m=>ctx.moves.indexOf(m)+1);
      panel.innerHTML='<strong>Random candidate order</strong><div>'+order.join(' → ')+'</div>'+ctx.trace.map(t=>'<div>#'+t.index+' · Q'+(t.candidate.column+1)+'→R'+t.candidate.row+' · h '+t.candidate.h+' · '+t.verdict+'</div>').join('');
    } else {
      panel.innerHTML='<strong>'+(model.phase==='random-selection'?'Random selection…':'Candidate probabilities')+'</strong>'+ctx.pool.map(m=>'<div class="pool-row '+(ctx.chosen&&key(m)===key(ctx.chosen)?'picked':'')+'"><span>Q'+(m.column+1)+'→R'+m.row+' · h '+m.h+' · Δ'+m.improvement+'</span><span>'+(m.probability*100).toFixed(2)+'%</span></div>').join('')+(ctx.randomValue!==null?'<div>Draw u = '+ctx.randomValue.toFixed(6)+' · chosen interval highlighted</div>':'');
    }
  }
  function renderCandidate(candidate=model.candidate,hover=false) {
    const panel=$('candidate-panel');
    if(!candidate) { panel.innerHTML='<span class="tiny-label">MOVE INSPECTOR</span><h3>Select a candidate</h3><p>Hover a value to read its full-board cost. Click to preview without changing current state.</p>'; $('candidate-actions').hidden=true; return; }
    const pending=candidate.pending;
    const oldH=E.calculateHeuristic(candidate.source);
    const pairs=pending?[]:E.getAttackingPairs(candidate.state);
    const worse=!pending&&candidate.h>oldH;
    panel.innerHTML='<span class="tiny-label">'+(hover?'HOVER INSPECTION':'CANDIDATE BOARD')+'</span><h3>Q'+(candidate.column+1)+' · row '+candidate.from+' → '+candidate.row+'</h3><div class="candidate-states"><span>Old</span><code>'+esc(arrayText(candidate.source))+'</code><span>Candidate</span><code>'+esc(arrayText(candidate.state))+'</code><span>Total h</span><strong>'+(pending?'? · not evaluated':candidate.h+' attacking pair'+(candidate.h===1?'':'s'))+'</strong></div><p>'+(pending?'The algorithm has not calculated this whole-board cost yet. An explicit click evaluates a separate study preview.':'Temporarily move one queen; test ALL pairs on the entire resulting board.')+'</p>'+(!pending?'<div class="pair-mini">Remaining attacks: '+(pairs.length?pairs.map(p=>'Q'+(p.i+1)+' ↔ Q'+(p.j+1)+' ('+esc(p.reason)+')').join(', '):'none')+'.</div><details class="candidate-pair-details"><summary>Every pair in this candidate</summary>'+E.getPairTests(candidate.state).map(p=>'<div>Q'+(p.i+1)+'–Q'+(p.j+1)+' → '+(p.attack?'ATTACK · '+esc(p.reason):'safe')+'</div>').join('')+'</details>':'')+(worse?'<p class="override-warning">This move increases h from '+oldH+' to '+candidate.h+'. Basic hill climbing would not take it. Force Move manually overrides the algorithm.</p>':'');
    if(hover) return;
    const stale=!sameState(candidate.source,model.state);
    const waiting=model.status==='awaiting_choice';
    const validBest=waiting&&model.ctx.best.some(m=>key(m)===key(candidate));
    $('candidate-actions').hidden=pending;
    $('apply-move').hidden=worse;
    $('apply-move').textContent=waiting?'Apply manual move':'Apply this move';
    $('force-move').hidden=!worse;
    $('choose-best').hidden=!validBest;
    $('apply-move').disabled=$('force-move').disabled=stale;
    $('preview-move').disabled=false;
  }
  function renderPairs() {
    const state=displayState(),pending=displayPending();
    const tests=pending?[]:E.getPairTests(state),pairs=tests.filter(p=>p.attack);
    $('pairs-title').textContent=pending?'Why is h still unknown?':'Why is h = '+pairs.length+'?';
    $('pairs-view-tag').textContent=model.view==='current'?'Current board':model.view==='history'?'History inspection':'Candidate board';
    $('attacking-pairs').innerHTML=pending?'<p class="muted">This candidate is only being inspected. The next operation evaluates its pairs.</p>':pairs.length?pairs.map(p=>'<div class="pair-card"><strong>Q'+(p.i+1)+' ↔ Q'+(p.j+1)+'</strong><span class="reason">'+esc(p.reason)+'</span><p>Q'+(p.i+1)+' = ('+p.columnA+','+p.rowA+') · Q'+(p.j+1)+' = ('+p.columnB+','+p.rowB+') · (column,row)</p><code>'+(p.sameRow?p.rowA+' = '+p.rowB+' → same row':'|'+p.rowA+' − '+p.rowB+'| = |'+p.columnA+' − '+p.columnB+'| → '+Math.abs(p.rowA-p.rowB)+' = '+Math.abs(p.columnA-p.columnB))+'</code></div>').join(''):'<div class="no-attacks">✓ Every queen pair is safe. h = 0.</div>';
    $('pair-count').textContent=model.columns*(model.columns-1)/2+' pair tests';
    $('pair-tests').innerHTML=tests.map(p=>'<tr><td><strong>Q'+(p.i+1)+' vs Q'+(p.j+1)+'</strong><span>('+p.columnA+','+p.rowA+') · ('+p.columnB+','+p.rowB+')</span></td><td>'+p.rowA+' = '+p.rowB+'<br><span>'+p.sameRow+'</span></td><td>|'+p.rowA+'−'+p.rowB+'| = |'+p.columnA+'−'+p.columnB+'|<br>'+Math.abs(p.rowA-p.rowB)+' = '+Math.abs(p.columnA-p.columnB)+'<br><span>'+p.sameDiagonal+'</span></td><td class="'+(p.attack?'yes':'no')+'">'+(p.attack?'YES +1':'NO +0')+'</td></tr>').join('');
    $('pair-total').textContent=pending?'h has not been evaluated yet.':'C('+model.columns+',2) = '+model.columns+'('+model.columns+'−1)/2 = '+tests.length+' pairs checked; sum of attacks = h = '+pairs.length;
  }
  function renderHistory() {
    $('history-count').textContent=model.history.length+' states';
    $('history-list').innerHTML=model.history.map((entry,i)=>'<button class="history-item '+(i===model.historyIndex?'selected ':'')+(i===model.history.length-1&&sameState(entry.state,model.state)?'actual':'')+'" data-index="'+i+'"><span>Attempt '+(entry.restart+1)+' · Iteration '+entry.iteration+' <small>'+esc(entry.type)+'</small></span><code>'+esc(arrayText(entry.state))+'</code><b class="history-h">h '+entry.h+'</b><span><small>'+esc(entry.description)+'</small></span>'+(entry.trace.length?'<span><small>'+entry.trace.length+' candidate checks recorded</small></span>':'')+'</button>').join('');
    const entry=model.historyIndex!==null?model.history[model.historyIndex]:null;
    $('history-details').hidden=!entry;
    if(entry) {
      const scan=entry.scan;
      $('history-details').innerHTML='<strong>Recorded '+esc(entry.mode)+' transition</strong>'+(scan?'<p>Source '+esc(arrayText(scan.source))+' · '+scan.evaluated.length+' algorithm evaluations.</p><details><summary>Evaluated candidates & selection</summary>'+scan.evaluated.map(m=>'<div>Q'+(m.column+1)+'→R'+m.row+' · h '+m.h+'</div>').join('')+(scan.pool.length?'<p>Probabilities: '+scan.pool.map(m=>'Q'+(m.column+1)+'R'+m.row+' '+(m.probability*100).toFixed(1)+'%').join(', ')+'</p><p>Random draw: '+(scan.randomValue??'—')+'</p>':'')+(scan.order.length?'<p>Random order: '+scan.order.map(m=>'Q'+(m.column+1)+'R'+m.row).join(' → ')+'</p>':'')+'</details>':'<p>Initial, restored, or random restart state.</p>');
    }
  }
  function renderCounts() {
    const rows=model.rows,cols=model.columns;
    const states=(BigInt(rows)**BigInt(cols)).toLocaleString('en-US');
    $('counts-explanation').innerHTML='<div class="count-item"><span class="tiny-label">NEIGHBORS OF ONE STATE</span><strong>'+cols+' × '+(rows-1)+' = '+cols*(rows-1)+'</strong><p>'+cols+' queens, each with '+(rows-1)+' alternative rows. Square formula: N(N − 1). 4 × 3 = 12; 8 × 7 = 56.</p></div><div class="count-item"><span class="tiny-label">TOTAL COMPLETE STATE SPACE</span><strong>'+rows+'<sup>'+cols+'</sup> = '+states+'</strong><p>Each column independently chooses a row. Square formula: Nᴺ. 4⁴ = 256; 8⁸ = 16,777,216.</p></div><div class="count-item"><span class="tiny-label">PAIRS TESTED PER BOARD</span><strong>C('+cols+', 2) = '+cols*(cols-1)/2+'</strong><p>'+cols+'('+cols+' − 1)/2 unordered queen pairs. h is the number of those pairs that attack, counted once.</p></div>';
  }
  function renderStats() {
    const stats=[['Algorithm',L.algorithms?.[mode()]?.name||mode()],['Board',model.rows+' × '+model.columns],['Search moves / manual moves',model.algorithmMoves+' / '+model.manualMoves],['Candidates evaluated',model.evaluations],['Scans begun',model.scans],['Standard full-scan baseline',model.scans*model.columns*(model.rows-1)],['Restarts / stuck attempts',model.restarts+' / '+model.stuckAttempts],['Successful attempts',model.successfulAttempts],['Best evaluated h / state',model.bestH+' · '+arrayText(model.bestState)],['Random selections',model.randomSelections],['Current h',E.calculateHeuristic(model.state)],['Total iterations',model.totalIterations]];
    $('run-statistics').innerHTML=stats.map(([label,value])=>'<div class="stat-item">'+esc(label)+'<strong>'+esc(value)+'</strong></div>').join('');
    $('run-statistics').nextElementSibling.textContent='Experiment totals persist across mode changes until Reset. Manual previews and Reveal all are study operations, excluded from algorithm evaluation counts. The baseline is scans begun × neighbors per scan; an unfinished scan is included.';
  }
  function renderAlgorithm() {
    const meta=L.algorithms?.[mode()];
    if(!meta) return;
    $('mode-simple').textContent=meta.simple;
    $('stochastic-settings').hidden=mode()!=='stochastic';
    $('selected-algorithm-detail').innerHTML='<div><h3>'+esc(meta.name)+'</h3><p>'+esc(meta.technical)+'</p><p><strong>Visualization:</strong> '+esc(meta.visual)+'</p></div><div><p><strong>Advantage:</strong> '+esc(meta.advantages)+'</p><p><strong>Tradeoff:</strong> '+esc(meta.disadvantages)+'</p><p><strong>When stuck:</strong> '+esc(meta.stuck)+'</p></div>';
    $('comparison-content').innerHTML=L.renderComparison?L.renderComparison():'';
    const explanations={standard:['The algorithm does not choose a queen first.','It compares all complete candidate boards. The smallest cost determines both the queen and its destination row.'],restart:['Steepest descent within each attempt.','Compare all complete neighbors, then restart from a new random state when the search is stuck.'],stochastic:['Randomly choose an improving complete board.','All eligible improving moves receive probabilities. The random draw determines the queen and destination; it can choose a nonminimum neighbor.'],'first-choice':['The first improvement ends the scan.','Generate moves without costs, shuffle their order, and evaluate one complete candidate board at a time. Untested neighbors stay unknown.']};
    document.querySelector('.decision-note').innerHTML='<strong>'+explanations[mode()][0]+'</strong><p>'+explanations[mode()][1]+'</p>';
    const tieActive=['standard','restart'].includes(mode());
    $('tie-break').disabled=!tieActive;
    $('tie-break').title=tieActive?'Choose how to break ties among minimum-cost successors.':'This mode uses its own random selection rule.';
  }
  function runTests() {
    const tests=E.selfTests();
    const passed=tests.filter(t=>t.pass).length;
    $('test-summary').textContent=passed+' / '+tests.length+' passed';
    $('test-results').innerHTML=tests.map(t=>'<div class="test-result '+(t.pass?'pass':'fail')+'">'+(t.pass?'✓':'✕')+' '+esc(t.name)+'<small>'+esc(t.detail)+'</small></div>').join('');
    return tests;
  }
  function renderAll() {
    if(fastForward) return;
    renderMetrics(); renderBoard(); renderSuccessorMatrix(); renderDebugger();
    renderCandidate(); renderPairs(); renderHistory(); renderCounts(); renderStats(); renderControls();
    if($('learning-content').dataset.dimensions!==model.rows+':'+model.columns) {
      $('learning-content').innerHTML=L.render(model.rows,model.columns);
      $('learning-content').dataset.dimensions=model.rows+':'+model.columns;
    }
  }
  function configureDimensions() {
    const square=$('square-mode').checked;
    $('n-input').disabled=!square; $('rows-input').disabled=$('cols-input').disabled=square;
    if(square) { $('rows-input').value=$('cols-input').value=$('n-input').value; }
  }
  function readConfiguration(forceRandom) {
    const square=$('square-mode').checked;
    const rows=Number($(square?'n-input':'rows-input').value);
    const columns=Number($(square?'n-input':'cols-input').value);
    if(!Number.isInteger(rows)||!Number.isInteger(columns)||rows<1||columns<1||rows>20||columns>20) throw new Error('Rows and columns must be whole numbers from 1 to 20.');
    let state;
    if(forceRandom||$('initial-mode').value==='random') state=E.randomState(rows,columns);
    else {
      const input=$('custom-state').value.trim();
      try { state=JSON.parse(input.startsWith('[')?input:'['+input+']'); } catch (_) { throw new Error('Enter a row array such as [4,3,4,2], or comma-separated rows.'); }
      if(!Array.isArray(state)||state.length!==columns) throw new Error('Enter exactly '+columns+' row values: one per column.');
      E.validateState(state,rows);
    }
    return {state,rows,columns};
  }
  function generateBoard(forceRandom=false) {
    try { const config=readConfiguration(forceRandom); newExperiment(config.state,config.rows,config.columns); }
    catch(error) { $('config-message').className='config-message error'; $('config-message').textContent=error.message; }
  }
  function choosePreset(id) {
    const preset=E.getPreset(id); if(!preset) return;
    $('square-mode').checked=preset.rows===preset.columns;
    $('n-input').value=preset.rows; $('rows-input').value=preset.rows; $('cols-input').value=preset.columns;
    configureDimensions();
    const state=preset.random?E.randomState(preset.rows,preset.columns):preset.state;
    $('initial-mode').value=preset.random?'random':'custom'; $('custom-state').value=JSON.stringify(state);
    if(preset.id==='sequence4') $('tie-break').value='manual';
    newExperiment(state,preset.rows,preset.columns,preset.description);
  }
  function bindEvents() {
    $('square-mode').addEventListener('change',configureDimensions);
    $('n-input').addEventListener('input',configureDimensions);
    $('generate-board').addEventListener('click',()=>generateBoard());
    $('new-random').addEventListener('click',()=>generateBoard(true));
    $('preset-select').addEventListener('change',e=>choosePreset(e.target.value));
    $('start').addEventListener('click',play); $('pause').addEventListener('click',()=>pause());
    $('next-phase').addEventListener('click',()=>{pause(false);nextStep();});
    $('next-iteration').addEventListener('click',nextIteration);
    $('reset').addEventListener('click',resetSearch);
    $('speed').addEventListener('change',()=>{if(model.running) schedule();});
    $('auto-run').addEventListener('change',()=>{if(!$('auto-run').checked) pause();});
    $('algorithm-mode').addEventListener('change',()=>{renderAlgorithm();invalidateSearch('Algorithm changed. Current board and history retained; the next scan uses the selected variant.');});
    ['tie-break','allow-sideways','sideways-limit','stochastic-selection'].forEach(id=>$(id).addEventListener('change',()=>invalidateSearch('Search rule changed. Start a fresh scan of the current state.')));
    ['restart-limit','unlimited-restarts','auto-restart'].forEach(id=>$(id).addEventListener('change',()=>{renderAll();announce('Restart settings updated.');}));
    $('random-restart').addEventListener('click',()=>randomRestart());
    ['show-lines','show-coords','show-ids','show-heuristics'].forEach(id=>$(id).addEventListener('change',renderBoard));
    $('queen-layer').addEventListener('click',e=>{const button=e.target.closest('.queen');if(!button) return;pause(false);returnCurrent(false);model.selectedColumn=Number(button.dataset.column);model.manualSelection=true;announce('Selected Q'+(model.selectedColumn+1)+'. Destination labels show whole-board h after moving it (manual study inspection).');renderAll();});
    $('board-cells').addEventListener('click',e=>{const cell=e.target.closest('.destination');if(!cell) return;inspectCandidate(Number(cell.dataset.column),Number(cell.dataset.row),true);});
    $('successor-matrix').addEventListener('click',e=>{const button=e.target.closest('button');if(button) inspectCandidate(Number(button.dataset.column),Number(button.dataset.row));});
    $('successor-matrix').addEventListener('mouseover',e=>{const button=e.target.closest('button');if(button) hoverCandidate(Number(button.dataset.column),Number(button.dataset.row));});
    $('successor-matrix').addEventListener('focusin',e=>{const button=e.target.closest('button');if(button) hoverCandidate(Number(button.dataset.column),Number(button.dataset.row));});
    $('successor-matrix').addEventListener('mouseleave',()=>renderCandidate());
    $('reveal-values').addEventListener('click',()=>{availableMoves().forEach(m=>model.studyValues.set(studyKey(m,getMatrixBase()),E.evaluateCandidate(m)));model.reveal=true;announce('All h values revealed for learning. Search evaluations and first-choice order are unchanged.');renderAll();});
    $('preview-move').addEventListener('click',()=>{if(model.candidate){model.view='candidate';renderAll();}});
    $('apply-move').addEventListener('click',()=>applyMove(false)); $('force-move').addEventListener('click',()=>applyMove(true));
    $('choose-best').addEventListener('click',()=>{if(model.status!=='awaiting_choice'||!model.candidate)return;const chosen=model.ctx.best.find(m=>key(m)===key(model.candidate));if(!chosen)return;model.ctx.chosen=chosen;selectChosen();announce('Tie resolved. Next Step highlights the destination; the following step commits the board.');renderAll();});
    $('return-current').addEventListener('click',()=>returnCurrent());
    $('return-history').addEventListener('click',()=>returnCurrent());
    $('history-list').addEventListener('click',e=>{const button=e.target.closest('[data-index]');if(button)inspectHistory(Number(button.dataset.index));});
    $('previous').addEventListener('click',()=>inspectHistory(model.historyIndex!==null?Math.max(0,model.historyIndex-1):Math.max(0,model.history.length-2)));
    $('restore-history').addEventListener('click',restoreHistory);
    $('theme-toggle').addEventListener('click',()=>{const light=document.body.classList.toggle('light');$('theme-toggle').textContent=light?'☾':'☀';$('theme-toggle').setAttribute('aria-label','Switch to '+(light?'dark':'light')+' theme');});
    $('run-tests').addEventListener('click',runTests);
  }
  // Small read-only/debug API helps verify the real playback controller in a browser.
  window.QueensLab = { snapshot:()=>({state:model.state.slice(),rows:model.rows,columns:model.columns,
    phase:model.phase,status:model.status,running:model.running,view:model.view,sideways:model.sideways,
    iteration:model.iteration,totalIterations:model.totalIterations,restarts:model.restarts,
    evaluations:model.evaluations,scans:model.scans,randomSelections:model.randomSelections,
    checked:model.ctx?.evaluated.size||0,totalCandidates:model.ctx?.moves.length||model.columns*(model.rows-1),
    chosen:model.ctx?.chosen?Object.assign({},model.ctx.chosen):null,
    probabilities:model.ctx?.pool.map(m=>({column:m.column,row:m.row,h:m.h,probability:m.probability}))||[],
    history:model.history.map(entry=>Object.assign({},entry)),stop:model.stop,
    order:model.ctx?.order.map(m=>({column:m.column,row:m.row}))||[]}),
    nextStep,nextIteration,pause,choosePreset,runTests};
  bindEvents();
  $('preset-select').insertAdjacentHTML('beforeend',E.PRESETS.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join(''));
  renderAlgorithm();
  newExperiment([4,3,4,2],4,4,'Worked example: h = 3. Use Next Step to see exactly how a successor is evaluated.');
  $('learning-content').innerHTML=L.render(model.rows,model.columns);
  runTests();
})();
