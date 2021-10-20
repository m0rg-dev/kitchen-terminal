var task_update_timeouts = new Map();

var meals = {
    today: {
        recipe_name: "<loading>"
    }
};

var tasks = [

];

function date_iso8601_us_pacific(d = new Date()) {
    const usp = new Date(d.toLocaleString('en-US', { timeZone: "US/Pacific" }));
    return usp.getFullYear() + "-" + (usp.getMonth() + 1).toString().padStart(2, '0') + "-" + usp.getDate().toString().padStart(2, '0');
}

function date_readable() {
    const d = new Date();
    return d.toLocaleDateString('en-US', { timeZone: "US/Pacific", weekday: "short" }) + ", " + date_iso8601_us_pacific(d);
}

function applyTemplates() {
    Array.prototype.forEach.call(document.getElementsByClassName("templated"), el => {
        Array.prototype.forEach.call(document.getElementsByClassName("templated-" + el.id), el2 => {
            el2.remove();
        });

        // oh yeah it's XSS time baby
        const new_element = el.cloneNode(true);
        new_element.innerHTML = el.innerHTML.replace(/{{(.*?)}}/gs, function (a, b) {
            return escapeHTML(eval(b));
        });
        new_element.classList.add("templated-" + el.id);
        new_element.classList.remove("templated");
        new_element.style.display = "block";
        el.after(new_element);
        el.style.display = "none";
    });

    Array.prototype.forEach.call(document.getElementsByClassName("templated-multi"), el => {
        Array.prototype.forEach.call(document.getElementsByClassName("templated-" + el.id), el2 => {
            el2.remove();
        });

        const src_obj = eval(el.getAttribute("multi_source"));
        src_obj.forEach((obj, idx) => {
            var multi = obj;
            const new_element = el.cloneNode(true);
            new_element.innerHTML = el.innerHTML.replace(/{{(.*?)}}/g, function (a, b) {
                return escapeHTML(eval(b));
            });
            new_element.id = el.id + "-" + idx;
            new_element.classList.add("templated-" + el.id);
            new_element.classList.remove("templated-multi");
            new_element.style.display = "block";
            el.after(new_element);
        });
        el.style.display = "none";
    });

    addNavbarHooks();
}

function updateNavbar(selected) {
    Array.prototype.forEach.call(document.getElementsByClassName("navbar-item"), el => {
        if (el == selected) {
            el.classList.add("navbar-item-selected");
        } else {
            el.classList.remove("navbar-item-selected");
        }
    });

    const selector = selected.getAttribute("nav_target");
    console.log(`selected: ${selector}`);
    window.location.hash = `#${selector}`;

    Array.prototype.forEach.call(document.getElementsByClassName("view"), el => {
        if (el.id == "view-" + selector) {
            el.classList.add("view-active");
        } else {
            el.classList.remove("view-active");
        }
    });
}

function addNavbarHooks() {
    Array.prototype.forEach.call(document.getElementsByClassName("navbar-item"), el => {
        el.addEventListener("click", () => updateNavbar(el));
    });
}

async function setup() {
    if (window.location.hash) {
        Array.prototype.forEach.call(document.getElementsByClassName("navbar-item"), el => {
            if ("#" + el.getAttribute("nav_target") == window.location.hash) {
                updateNavbar(el);
            }
        });
    }

    applyTemplates();

    load_tasks();

    meals.today = await getObject(`meals/${date_iso8601_us_pacific()}`, {
        recipe_name: "nothing planned"
    }, false);
    console.log(meals.today);
    applyTemplates();

    setInterval(reloadAllData, 10 * 1000);
}

async function reloadAllData() {
    load_tasks();
}

function escapeHTML(html) {
    return document.createElement('div').appendChild(document.createTextNode(html)).parentNode.innerHTML;
}

setup();

function displayError(text) {
    // TODO
    console.error(text);
}

async function getObject(data_path, def, should_update = true) {
    // Technically the default PUT should be locked around, but in this use case it's unlikely to matter.
    return fetch("/data/" + data_path).then(response => {
        if (response.status == 200) {
            return response.json();
        } else if (response.status == 404) {
            if (def) {
                const serialized = JSON.stringify(def);
                if (should_update) {
                    fetch("/data/" + data_path, {
                        method: "PUT",
                        body: serialized
                    });
                }
                return JSON.parse(serialized);
            }
        } else {
            displayError(`Error fetching ${data_path}: ${response.statusText}`);
        }
    });
}

async function getListing(data_path) {
    return fetch("/data/" + data_path).then(response => {
        if (response.status = 200) {
            return response.json().then(arr => arr.map(x => x.name));
        } else if (response.status == 404) {
            return [];
        } else {
            displayError(`Error listing ${data_path}: ${response.statusText}`);
        }
    })
}

async function putObject(data_path, value) {
    return fetch("/data/" + data_path, {
        method: "PUT",
        body: JSON.stringify(value)
    });
}

async function deleteObject(data_path) {
    return fetch("/data/" + data_path, {
        method: "DELETE",
    });
}

function uuidv4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

// Task management.

async function add_task() {
    const new_task_uuid = uuidv4();
    await putObject("tasks/" + new_task_uuid, {
        name: "New Task",
        description: "New Description",
        priority: Date.now(),
        id: new_task_uuid
    });

    await load_tasks();
}

function update_task(id) {
    if (task_update_timeouts.has(id)) {
        clearTimeout(task_update_timeouts.get(id));
    }

    task_update_timeouts.set(id, setTimeout(() => {
        putObject("tasks/" + id, {
            name: document.getElementById("task-header-" + id).innerText,
            description: document.getElementById("task-description-" + id).innerText,
            priority: Date.now(),
            id: id
        });
        task_update_timeouts.delete(id);
    }, 1000));
}

async function load_tasks() {
    if (task_update_timeouts.size) {
        // avoid scribbling on a task someone is actively updating
        return;
    }
    const ids = await getListing("tasks/");
    const items =
        (await Promise.all(ids.map(async x => { return { id: x, task: await getObject(`tasks/${x}`, undefined, false) } }))).filter(x => x.task);

    items.forEach(item => {
        if (!item.task.priority) {
            console.log(`Found task ${item.id} with no priority, deleting.`);
            deleteObject(`tasks/${item.id}`);
        }

        if (!item.task.id) {
            console.log(`Found task ${item.id} without own ID, deleting.`);
            deleteObject(`tasks/${item.id}`);
        }
    });

    const items_objects = items.map(x => x.task);
    items_objects.sort((a, b) => a.priority - b.priority);

    tasks = items_objects;
    applyTemplates();
}

async function delete_task(id) {
    deleteObject(`tasks/${id}`);
    await load_tasks();
}

/*
async function task_commit() {
    if (task_update_timeout) {
        clearTimeout(task_update_timeout);
    }

    await putObject("tasks/" + new_task_uuid, {
        name: document.getElementById("new-task-name").innerText,
        description: document.getElementById("new-task-description").innerText,
        priority: Date.now(),
        id: new_task_uuid
    });

    new_task_uuid = undefined;
    await load_tasks();
    document.getElementById("add-task-button").style.display = "block";
    document.getElementById("new-task").style.display = "none";
}

async function task_cancel() {
    new_task_uuid = undefined;
    await delete_task(new_task_uuid);
    document.getElementById("add-task-button").style.display = "block";
    document.getElementById("new-task").style.display = "none";
}
*/
