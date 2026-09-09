import json, os, glob, collections

A = r"C:\Users\OMEN\Desktop\PratiBimb\artifacts\experiments\W1-S04a1-four-model-residency"
prov = json.load(open('model-provenance.json', encoding='utf8'))


def cells():
    out = []
    for f in glob.glob('results-s04a1-*.json'):
        d = json.load(open(f, encoding='utf8'))
        browser = d.get('browser', 'chrome')
        for r in d['runs']:
            ctxs = r.get('contexts') or [x for x in r.get('reported', []) if x.get('context') != '__alive__']
            for c in ctxs:
                if c.get('probe') == 's04a1-pressure':
                    out.append({'log': f, 'browser': browser, 'context': c['context'], 'kind': 'pressure',
                                'stoppedBecause': c.get('stoppedBecause'),
                                'impossibleAlloc': c.get('impossibleAlloc'),
                                'escalation': c.get('escalation'), 'afterRelease': c.get('afterRelease')})
                    continue
                if not c.get('residentSnapshots') and not c.get('baselines'):
                    continue
                agg = collections.defaultdict(lambda: {'ok': 0, 'bad': 0, 'worst': 0.0})
                for rep in c.get('correctness', []):
                    k = rep['model']
                    agg[k]['ok' if rep['correct'] else 'bad'] += 1
                    agg[k]['worst'] = max(agg[k]['worst'], rep['worstRelErr'])
                res = [{'label': s['label'], 'mb': s['wasm']['mb'], 'grows': s['wasm']['growCount'],
                        'instances': s['wasm']['instances']} for s in c.get('residentSnapshots', [])]
                cyc = [{'label': s['label'], 'mb': s['wasm']['mb'], 'grows': s['wasm']['growCount']}
                       for s in c.get('cycleSnapshots', [])]
                life = [{'label': s['label'], 'mb': s['wasm']['mb'], 'grows': s['wasm']['growCount']}
                        for s in c.get('lifecycleSnapshots', [])]
                base = {k: {'weightsBytes': v['modelBytes'], 'afterCreateMB': v['afterCreate']['mb'],
                            'afterInferMB': v['afterInfer']['mb'], 'growsAdded': v['growsAdded'],
                            'createMs': v['createMs'], 'destroyMs': v['destroyMs'], 'correct': v['correct']}
                        for k, v in (c.get('baselines') or {}).items()}
                out.append({'log': f, 'browser': browser, 'context': c['context'], 'kind': 'lifecycle',
                            'backend': c.get('backend'), 'phase': c.get('phase'), 'headless': r.get('headless'),
                            'env': c.get('env'), 'grows': len(c.get('growthEvents', [])),
                            'growthEvents': [[g['beforeMB'], g['afterMB'], g['delta']] for g in c.get('growthEvents', [])],
                            'baselines': base, 'residentSnapshots': res,
                            'lifecycleSnapshots': life, 'cycleSnapshots': cyc,
                            'perModelCorrectness': {k: {'pass': v['ok'], 'fail': v['bad'],
                                                        'worstRelErrSumAbs': v['worst']} for k, v in agg.items()},
                            'allCorrect': c.get('allCorrect'), 'conclusion': c.get('conclusion')})
    return out


total = sum(x['bytes'] for x in prov['models'])
m = {
    "experiment": "W1-S04a1-four-model-residency", "date": "2026-09-09", "verdict": "CONDITIONAL",
    "models": prov['models'],
    "totalWeightsBytes": total,
    "headline": {
        "four_different_models": True,
        "growth_regime_reached": True,
        "grows_wasm": 11, "resident_peak_mb_wasm": 273.2,
        "grows_webgpu": 10, "resident_peak_mb_webgpu": 236.9,
        "sum_of_solo_peaks_mb": 407.7,
        "sub_additive_saving_pct": round((407.7 - 273.2) / 407.7 * 100, 1),
        "peak_over_weights_ratio": round(273.2 / (total / 1048576), 2),
        "incremental_cost_mb": {"face": 16.0, "ocr_det": 7.1, "ocr_rec": 57.3, "vlm_vision": 192.8},
        "s04a_identical_model_incremental_cost_mb": {"session2": 0.0, "session3": 0.0},
        "additional_grows_over_3_full_cycles": 0,
        "chrome_firefox_agree": True,
        "chrome_memory_instances": 1, "firefox_memory_instances": 2,
    },
    "correctness_criterion": {
        "statistic": "exact output count + cancellation-free sumAbs",
        "rtol_sumAbs": 2e-2,
        "why": ("raw sum is dominated by cancellation for vlm_vision (sum is 0.027% of n*scale); "
                "measured conditioning under a 1e-6 input perturbation reaches 9.8e-2 per element "
                "and 1.0e-1 on raw sum, but at most 2.9e-3 on sumAbs"),
        "conditioning_1e_minus_6_input_perturbation": {
            "face": {"maxElemOverScale": 3.3e-07, "sum": 7.7e-08, "sumAbs": 1.5e-08},
            "ocr_rec": {"maxElemOverScale": 1.4e-06, "sum": 1.5e-08, "sumAbs": 1.5e-08},
            "ocr_det": {"maxElemOverScale": 9.8e-02, "sum": 2.7e-06, "sumAbs": 2.7e-06},
            "vlm_vision": {"maxElemOverScale": 5.0e-02, "sum": 1.0e-01, "sumAbs": 2.9e-03}},
        "recorded_as_data_not_criteria": ["min", "max", "raw sum", "sampled values"],
    },
    "known_failures": {
        "ocr_det_wasm": {
            "relErrSumAbs": 4.119e-2, "criterion": 2e-2, "status": "FAILS the stated criterion",
            "analysis": ("sigmoid probability map driven into saturation by synthetic input; in "
                         "pre-sigmoid logit space web=-14.4669 vs native=-14.4248, a 0.29% "
                         "difference amplified by exp(); reported as a failure regardless; "
                         "follow-up S-04a-1a")},
        "vlm_vision_webgpu": {
            "relErrSumAbs": 2.18, "criterion": 2e-2, "status": "BROKEN, not rounding",
            "analysis": ("int8 MatMulInteger path on ORT Web WebGPU (JSEP) returns sumAbs off by "
                         "~3x while the same model is correct on wasm; follow-up S-04a-1b")},
    },
    "section10_failure_behaviour": {
        "real_exhaustion": ("UNKNOWN - not safely reproducible (23 GB host, only ~4.1 GB free; "
                            "wasm32 ceiling is 4 GB, so a real workload would exhaust host RAM first)"),
        "bounded_escalation": {"rounds": 8, "liveSessions": 32, "peakMB": 1118.1, "grows": 20,
                               "failure": "none", "stoppedBecause": "max rounds reached without failure",
                               "perRoundCostMB": "~110-120 after the first round"},
        "impossible_allocations": {
            "wasm_memory_65537_pages": "RangeError: value 65537 is above the upper bound 65536",
            "float32array_2_pow_31": "RangeError: Array buffer allocation failed",
            "verdict": "EXPLICIT failure; no silent truncation, no corruption, no crash"},
    },
    "unknowns": {
        "gpu_side_memory": "UNKNOWN - not visible to this instrumentation",
        "real_heap_exhaustion": "UNKNOWN - see section10_failure_behaviour",
        "fifth_model": "UNTESTED",
        "ui_element_detector": "EXCLUDED - OmniParser icon_detect is AGPL-3.0 at the pinned revision",
        "latency": "not claimed; timings are feasibility data only",
    },
    "cells": cells(),
}

json.dump(m, open(os.path.join(A, 'metrics.json'), 'w', encoding='utf8'), indent=2)
print("metrics.json written:", len(m['cells']), "cells")
for c in m['cells']:
    if c['kind'] == 'lifecycle' and not c.get('headless'):
        print("  %-48s %-7s grows=%-3d %s" % (c['log'][:48], c.get('backend'), c['grows'],
                                              str(c.get('conclusion'))[:40]))
