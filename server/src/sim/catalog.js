// The demo fleet: twelve compressors across four Indian cold-chain sites.

export const SITES = [
  { id: 'PUN', name: 'Chakan Cold Hub', city: 'Pune' },
  { id: 'NSK', name: 'Pimpalgaon Agri Store', city: 'Nashik' },
  { id: 'DEL', name: 'Azadpur Produce Terminal', city: 'Delhi' },
  { id: 'CHN', name: 'Ennore Reefer Yard', city: 'Chennai' },
];

export const FLEET = [
  { id: 'CMP-PUN-01', site: 'PUN', name: 'Blast freezer A', type: 'Semi-hermetic reciprocating', refrigerant: 'R-404A', capacityTR: 22, installed: '2019-03-14' },
  { id: 'CMP-PUN-02', site: 'PUN', name: 'Dairy chiller line', type: 'Scroll', refrigerant: 'R-448A', capacityTR: 15, installed: '2021-07-02' },
  { id: 'CMP-PUN-03', site: 'PUN', name: 'Dock pre-cooler', type: 'Scroll', refrigerant: 'R-448A', capacityTR: 12, installed: '2022-01-19' },
  { id: 'CMP-NSK-01', site: 'NSK', name: 'Onion storage bay 1', type: 'Screw', refrigerant: 'R-717', capacityTR: 40, installed: '2017-10-05' },
  { id: 'CMP-NSK-02', site: 'NSK', name: 'Grape pre-cooling tunnel', type: 'Semi-hermetic reciprocating', refrigerant: 'R-404A', capacityTR: 25, installed: '2018-12-11' },
  { id: 'CMP-NSK-03', site: 'NSK', name: 'Ripening chamber', type: 'Scroll', refrigerant: 'R-134a', capacityTR: 10, installed: '2023-04-28' },
  { id: 'CMP-DEL-01', site: 'DEL', name: 'Fruit cold room 4', type: 'Semi-hermetic reciprocating', refrigerant: 'R-404A', capacityTR: 20, installed: '2016-06-21' },
  { id: 'CMP-DEL-02', site: 'DEL', name: 'Frozen goods vault', type: 'Screw', refrigerant: 'R-717', capacityTR: 45, installed: '2015-02-09' },
  { id: 'CMP-DEL-03', site: 'DEL', name: 'Vegetable chamber 2', type: 'Scroll', refrigerant: 'R-448A', capacityTR: 14, installed: '2020-09-30' },
  { id: 'CMP-CHN-01', site: 'CHN', name: 'Reefer plug bank A', type: 'Scroll', refrigerant: 'R-134a', capacityTR: 8, installed: '2021-11-17' },
  { id: 'CMP-CHN-02', site: 'CHN', name: 'Seafood blast freezer', type: 'Semi-hermetic reciprocating', refrigerant: 'R-404A', capacityTR: 28, installed: '2018-05-23' },
  { id: 'CMP-CHN-03', site: 'CHN', name: 'Pharma cold store', type: 'Scroll', refrigerant: 'R-134a', capacityTR: 11, installed: '2022-08-08' },
];

// Faults already developing when the demo starts, so the console is alive
// from the first second. Progress is the fraction of the drift completed.
export const PRESEEDED = [
  { unit: 'CMP-NSK-02', mode: 'oil_starvation', severity: 1.0, durationDays: 7, progress: 0.62 },
  { unit: 'CMP-DEL-01', mode: 'refrigerant_leak', severity: 0.9, durationDays: 8, progress: 0.12 },
];
