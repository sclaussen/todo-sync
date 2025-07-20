We need to handle more complex scenarios:

- Synchronization summary: I would like to get a summary of the
  synchronization, concretely what the delta was to the ~/.todo, what the
  deltas were to todoist, and then a breakdown of the deltas, whatever is
  required, for example, todos that changed priority, that were changed to
  completed, that were reworded, et al.  In other words, we need a very
  deterministic set of change groups to summarize the updates.

- .todo file format: When we rewrite the Priority 0 through 4 sections,
  Priority 0 should be at the top, followed by the --- line separator (79
  chars) followed directly by each task.  Then, after the last task in the
  section, there should be blank line.  We must retain everything below the
  Priority sections 'as is' in the ~/.todo file.

- Clarity: If the system does not know how to perform the synchronization
  because there are potential ambiguities, let's work through a plan wrt how
  to address those.  For example, do we need to evaluated cancelled items
  like we do completed items?  Do we need additional metadata to enable
  automated merge management (and can we create that without making the
  ~/.todo file a mess)?  Do we want simple user intervention where I answer
  questions if ambiguities come up during synchronization?

- Completed Items: We need to account for cases where the todo was completed
  either in todoist or in the laptop environment using todoist apis for
  recently completed items (say the last two weeks) and using the
  ~/.todo.completed file.  If necessary, we can add completion dates to the
  ~/.todo.completed information to aid in only retrieving the last two weeks
  of completions.  So, if we are in sync, item "some todo" is in both lists,
  but is marked completed from one list, we need to make sure we account for
  that during synchronization.

- Duplicates: After synchronization there should never be a duplicate item in
  either activie to do list (both locally and todoist).

- Subtasks: I would like you to implement subtasks.  The capability exists in
  todoist.  In the ~/.todo file this can simply be written something like
  this:

  Priority 0
  -------------------------------------------------------------------------------
  some task
  some other task
    - some sub task
    - some other sub task
  some task 3
  ...
