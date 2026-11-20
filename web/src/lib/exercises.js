export const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core', 'Conditioning'];

export const EXERCISES = [
  { name: 'Bench press', muscle: 'Chest' },
  { name: 'Incline dumbbell press', muscle: 'Chest' },
  { name: 'Cable fly', muscle: 'Chest' },
  { name: 'Push-up', muscle: 'Chest' },
  { name: 'Deadlift', muscle: 'Back' },
  { name: 'Barbell row', muscle: 'Back' },
  { name: 'Lat pulldown', muscle: 'Back' },
  { name: 'Pull-up', muscle: 'Back' },
  { name: 'Seated cable row', muscle: 'Back' },
  { name: 'Overhead press', muscle: 'Shoulders' },
  { name: 'Lateral raise', muscle: 'Shoulders' },
  { name: 'Face pull', muscle: 'Shoulders' },
  { name: 'Barbell curl', muscle: 'Arms' },
  { name: 'Hammer curl', muscle: 'Arms' },
  { name: 'Triceps pushdown', muscle: 'Arms' },
  { name: 'Skull crusher', muscle: 'Arms' },
  { name: 'Back squat', muscle: 'Legs' },
  { name: 'Front squat', muscle: 'Legs' },
  { name: 'Romanian deadlift', muscle: 'Legs' },
  { name: 'Leg press', muscle: 'Legs' },
  { name: 'Walking lunge', muscle: 'Legs' },
  { name: 'Calf raise', muscle: 'Legs' },
  { name: 'Plank', muscle: 'Core' },
  { name: 'Hanging leg raise', muscle: 'Core' },
  { name: 'Cable crunch', muscle: 'Core' },
  { name: 'Rowing intervals', muscle: 'Conditioning' },
  { name: 'Sled push', muscle: 'Conditioning' },
];

export function muscleFor(name) {
  const hit = EXERCISES.find((e) => e.name.toLowerCase() === String(name || '').toLowerCase());
  return hit ? hit.muscle : 'Other';
}