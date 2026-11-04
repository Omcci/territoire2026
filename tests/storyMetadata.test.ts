import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STORY_STEPS } from '../src/components/story/steps.ts';

test('Récits : tout chapitre documenté déclare sources et limites non vides', () => {
  for (const step of STORY_STEPS) {
    if (step.dataNature === undefined) continue;
    assert.ok(step.sources && step.sources.length > 10, `${step.id} : sources manquantes`);
    assert.ok(step.limitations && step.limitations.length > 10, `${step.id} : limites manquantes`);
  }
});

test('Récits : le chapitre CatNat est observé, pas synthétique', () => {
  const catnat = STORY_STEPS.find((s) => s.id === 'memoire-catastrophes');
  assert.ok(catnat, 'chapitre memoire-catastrophes introuvable');
  assert.equal(catnat.dataNature, 'observed');
  assert.equal(catnat.layer, 'catnat');
});

test('Récits : Habiter cher et exposé compte trois étapes observées DVF × CatNat', () => {
  const etapes = STORY_STEPS.filter((s) => s.id.startsWith('habiter-cher-expose-'));
  assert.equal(etapes.length, 3);
  assert.deepEqual(
    etapes.map((s) => s.layer),
    ['prix_immo', 'catnat', 'cher_expose'],
  );
  for (const step of etapes) {
    assert.equal(step.dataNature, 'observed', `${step.id} doit être observé`);
    assert.ok(step.periodLabel && step.periodLabel.length > 3, `${step.id} : période manquante`);
    assert.match(step.sources ?? '', /DVF|GASPAR/);
  }
});

test('Récits : identifiants de chapitres uniques', () => {
  const ids = STORY_STEPS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('Récits : Services essentiels compte trois étapes observées BPE', () => {
  const etapes = STORY_STEPS.filter((s) => s.id.startsWith('services-'));
  assert.equal(etapes.length, 3);
  for (const step of etapes) {
    assert.equal(step.layer, 'services', `${step.id} doit porter la couche services`);
    assert.equal(step.dataNature, 'observed', `${step.id} doit être observé`);
    assert.match(step.sources ?? '', /BPE/);
    assert.match(step.limitations ?? '', /distance|travel|journey/i);
  }
});

test('Récits : Peut-on vivre sans voiture compte quatre étapes observées RP 2023', () => {
  const etapes = STORY_STEPS.filter((s) => s.id.startsWith('voiture-'));
  assert.equal(etapes.length, 4);
  assert.deepEqual(
    etapes.map((s) => s.layer),
    ['voiture_menages', 'voiture_travail', 'transports_communs', 'voiture_travail'],
  );
  for (const step of etapes) {
    assert.equal(step.dataNature, 'observed', `${step.id} doit être observé`);
    assert.match(step.sources ?? '', /Melodi|RP 2023|recensement/i);
  }
});

test('Récits : la synthèse compte deux étapes sur comptage observé documenté', () => {
  const etapes = STORY_STEPS.filter((s) => s.id.startsWith('synthese-'));
  assert.equal(etapes.length, 2);
  for (const step of etapes) {
    assert.equal(step.layer, 'fragilites', `${step.id} doit porter la couche fragilites`);
    assert.equal(step.dataNature, 'observed', `${step.id} doit être observé`);
    assert.match(step.limitations ?? '', /threshold/i);
  }
});
