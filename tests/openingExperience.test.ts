import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STORY_STEPS, openingState } from '../src/components/story/steps.ts';

test('Ouverture : carte neutre, aucun récit affiché, choix d’entrée en attente', () => {
  const opening = openingState();
  assert.equal(opening.mode, 'EXPLORE');
  assert.equal(opening.entryChoice, 'pending');
  assert.equal(opening.storyStep, 0);
});

test('Ouverture : entrer dans les récits active exactement le premier chapitre', () => {
  const opening = openingState();
  const first = STORY_STEPS[0];
  assert.ok(first, 'au moins un chapitre doit exister');
  // Les valeurs préchargées sont celles du chapitre 1 : couche, trajectoire, horizon.
  assert.equal(opening.indicator, first.layer);
  assert.equal(opening.scenario, first.defaultScenario);
  assert.equal(opening.year, first.defaultYear);
});
