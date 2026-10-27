// Plan review: the plan dose over its CT in one volume viewport (the dose viewport draws the CT behind it); other
// series can be dragged in. A mode selects it with hangingProtocol: 'radiarch-rt-dose'.

const doseFirst = {
  id: 'radiarch-rt-dose',
  locked: true,
  name: 'RT Dose over its CT',
  // a study with an RT Dose (scores it above protocols without rules when a mode offers several)
  protocolMatchingRules: [{ attribute: 'ModalitiesInStudy', constraint: { contains: ['RTDOSE'] }, weight: 10 }],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  defaultViewport: {
    viewportOptions: { viewportType: 'stack', toolGroupId: 'default', allowUnmatchedView: true },
    displaySets: [{ id: 'imageDisplaySet', matchedDisplaySetsIndex: -1 }],
  },
  displaySetSelectors: {
    doseDisplaySet: {
      seriesMatchingRules: [
        { attribute: 'isRTDose', constraint: { equals: true }, required: true },
        // the plan dose before per-beam doses
        { attribute: 'label', weight: 10, constraint: { contains: 'PLAN' } },
      ],
    },
    imageDisplaySet: {
      seriesMatchingRules: [{ weight: 10, attribute: 'numImageFrames', constraint: { greaterThan: { value: 0 } } }],
    },
  },
  stages: [
    {
      name: 'dose',
      viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: 1 } },
      viewports: [
        {
          viewportOptions: { viewportId: 'rtDose', viewportType: 'volume', orientation: 'axial', toolGroupId: 'default', allowUnmatchedView: true },
          displaySets: [{ id: 'doseDisplaySet' }],
        },
      ],
    },
  ],
};

export default function getHangingProtocolModule() {
  return [{ name: doseFirst.id, protocol: doseFirst }];
}
