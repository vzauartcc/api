import m from 'mongoose';

// Define a Course schema that includes _id
const courseSchema = new m.Schema({
  _id: { type: m.Schema.Types.ObjectId, auto: true },
  courseName: { type: String },
  description: { type: String },
  type: { type: String },
  facility: { type: String }
});

// Use courseSchema for the courses array in your TrainingModule schema
const trainingModuleSchema = new m.Schema({
  name: String,
  description: String,
  track: String, // "home" or "visiting"
  courses: [courseSchema], // Now each course will have an _id
  isExtension: { type: Boolean, default: false },
  prerequisites: [{ type: m.Schema.Types.ObjectId, ref: 'TrainingModule' }],
  extensionModule: { type: m.Schema.Types.ObjectId, ref: 'TrainingModule', default: null },
}, {
  collection: 'trainingModule'
});
  
export default m.model('TrainingModule', trainingModuleSchema, 'trainingModule');