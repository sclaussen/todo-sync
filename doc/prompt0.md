I have a ~/.todo file that looks like this:

Priority 0
-------------------------------------------------------------------------------
some todo item
some todo item

Priority 1
-------------------------------------------------------------------------------
some todo item
some todo item
some todo item

Priority 2
-------------------------------------------------------------------------------
some todo item
some todo item
some todo item
some todo item

Priority 3
-------------------------------------------------------------------------------
some todo item
some todo item
some todo item
some todo item

Priority 4
-------------------------------------------------------------------------------
some todo item
some todo item
some todo item
some todo item

I use an emacs todo mode to keep this file up to date, that project repo is here:
https://github.com/sclaussen/todo

I also have a todoist subscription.  I enter todos there as well manually.

I would like to explore an option to synchronize the todos between the two
systems.

If there are other sections in the ~/.todo file, they should just be ignored.
Likewise, if there are other things in todoist, they should ignore.

But I would like a portion of todoist, like a single project, that is used to
synchronize.

Priority 0 items in my ~/.todo file should map to Priority 1 items in todoist
with a due date of today.

Is it possible to perform a bidirectional sync?
