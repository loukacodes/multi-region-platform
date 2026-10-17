// Add a region here: one REGION_SEEDS row, plus an EMPLOYEE_SEEDS entry for dummy data.
const REGION_SEEDS = [
  { id: 'region_us', name: 'North America', db_file: 'region_us.db' },
  { id: 'region_eu', name: 'Europe', db_file: 'region_eu.db' },
  { id: 'region_apac', name: 'Asia Pacific', db_file: 'region_apac.db' },
  { id: 'region_latam', name: 'Latin America', db_file: 'region_latam.db' },
  { id: 'region_mea', name: 'Middle East and Africa', db_file: 'region_mea.db' },
];

// [employee name, job title, username, access role]
const EMPLOYEE_SEEDS = {
  region_us: [
    ['Alice Johnson', 'Lead Engineer', 'alice', 'Admin'],
    ['Marcus Lee', 'Data Engineer', 'marcus', 'Manager'],
    ['Priya Shah', 'HR Manager', 'priya', 'Viewer'],
  ],
  region_eu: [
    ['Bob Martinez', 'Product Manager', 'bob', 'Manager'],
    ['Chen Wei', 'Backend Developer', 'chen', 'Admin'],
    ['Sara Okafor', 'Financial Analyst', 'sara', 'Viewer'],
  ],
  region_apac: [
    ['Peter Gibbons', 'Software Consultant', 'peter', 'Manager'],
    ['Samir Nagheenanajar', 'Systems Analyst', 'samir', 'Viewer'],
    ['Milton Waddams', 'Facilities Manager', 'milton', 'Viewer'],
  ],
  region_latam: [
    ['Jill Valentine', 'Field Operations Lead', 'jill', 'Admin'],
    ['Albert Wesker', 'Research Director', 'albert', 'Manager'],
    ['Chris Redfield', 'Security Specialist', 'chris', 'Viewer'],
  ],
  region_mea: [
    ['Tony Stark', 'Chief Executive Officer', 'tony', 'Admin'],
    ['Pepper Potts', 'Operations Director', 'pepper', 'Manager'],
    ['Happy Hogan', 'Head of Security', 'happy', 'Viewer'],
  ],
};

module.exports = { REGION_SEEDS, EMPLOYEE_SEEDS };
