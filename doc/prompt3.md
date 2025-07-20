Code base simplification: I would to dramatically simplify the code base.

Here are the steps, execute them one by one, pausing in between for me to
review the results:
- Move the code from todo-sync/src to todo-sync, effectively moving it up one
  directory level so everything is in the root of the repository.
- Port all the code from TypeScript to Node.js.
- Come up with a plan to eliminate the need for config.js, let's discuss
  options, and then I'll approve the execution.
  - If there are pure utilities move them into a util.js.
- Refactor the code to use a procedural style vs a class object style and use
  that style going forward.
- Rename cli.js to sync.js.
- Refactor sync.js:
  - create a main()
  - have main call parseCliArguments()
  - in parseCliArguments, use commander to parse all the possible
    arguments
  - put the results in an options map, return the options map (removing
    clutter but providing which flags etc)
  - refator main to use the returned options to determine the business logic
  - Move the core sync algorithm directly into sync.js from syncEngine.js
    (effectively removing syncEngine.js), let's put the core sync logic into
    a sync() function that's invoked by main.js.
- In sync():
  - let's use the term "tasks" vs "todos" everywhere to be consistent
  - read the .todo tasks using the existing logic
  - invoke the function removeDuplicateTasks()
    - in this function, find duplicates, that may exist across priorities,
      remove those duplicates, and serialize the local tasks back out to
      .todo.
    - do the same thing for .todo.completed
    - do the same thing for .todo.cancelled
  - read the todoist tasks using the existing logic
  - invoke the function removeDuplicateTodoistTasks()
    - in this function, find duplicates, that may exist across priorities,
      remove those duplicates, remove the todoist tasks in the project, and
      then add the new non-duplicate tasks
    - do the same thing for the todist completed tasks
    - do the same thing for the todist cancelled tasks
