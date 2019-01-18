'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var fs = require('fs-extra');
var execa = _interopDefault(require('execa'));
var rollup = require('rollup');
var babel = _interopDefault(require('rollup-plugin-babel'));
var resolve = _interopDefault(require('rollup-plugin-node-resolve'));
var rollupPluginTerser = require('rollup-plugin-terser');
var commonjs = _interopDefault(require('rollup-plugin-commonjs'));
var replace = _interopDefault(require('rollup-plugin-replace'));
var rollupPluginSizeSnapshot = require('rollup-plugin-size-snapshot');
var Path = require('path');
var chroma = _interopDefault(require('chroma-js'));

const scale = chroma.scale([chroma('#fafa6e').darken(2), '#2A4858']).mode('lch');

function toDot(modules, output) {
  const results = [];
  results.push('digraph G {');
  results.push('  edge [color="#aaaaaa",dir=back];');
  results.push('  node [style=filled,color=white,fontsize="25px"];');
  results.push('  graph [fontsize=15 compound=true];');
  results.push('  rankdir=TB;');
  results.push('  ranksep=".95 equally";');
  results.push('  ratio=auto;');
  let links = [];
  const cwd = process.cwd() + '/';
  const modulesOnly = modules.map(md => {
    const id = processPath(md.id);
    const deps = md.deps.map(processPath);
    return {
      id,
      deps
    };
  });

  function processPath(path) {
    path = path.replace(cwd, '');
    path = path.replace('src/', '');
    path = path.replace('.js', '');
    path = path.replace(/(.+)\/index$/, '$1');
    return path;
  }

  const moduleNames = new Set();
  modulesOnly.forEach(m => {
    const from = m.id;
    moduleNames.add(from);
    m.deps.forEach(dep => {
      moduleNames.add(dep);
      links.push({
        from,
        to: dep
      });
    });
  });
  links = links.sort((a, b) => {
    if (a.from === b.from) {
      return a.to.localeCompare(b.to);
    }

    return a.from.localeCompare(b.from);
  });
  const moduleSet = [...moduleNames];

  const nextID = (() => {
    let id = 10;
    return () => `id_${(id++).toString(36)}`;
  })();

  const nameMap = {
    names: [],
    nameOf: {},
    idOf: {}
  };
  moduleSet.forEach(name => {
    const id = nextID();
    nameMap.nameOf[id] = name;
    nameMap.idOf[name] = id;
    nameMap.names.push(name);
  });
  let clusters = moduleSet.reduce((acc, name) => [...new Set([...acc, name.split('/')[0]])], []).map(name => ({
    name,
    childs: moduleSet.filter(n => n === name || n.startsWith(`${name}/`))
  }));
  clusters = clusters.filter((_ref, i, clusters) => {
    let name = _ref.name;
    return clusters.every((_ref2) => {
      let item = _ref2.name,
          childs = _ref2.childs;
      if (item === name) return true;
      return !childs.includes(name);
    });
  }).filter((_ref3) => {
    let childs = _ref3.childs;
    return childs.length > 1;
  });
  const freeNodes = new Set(moduleSet);
  const clusterRoots = {
    roots: new Set(),
    map: {},
    colors: {},
    clusterOf: {}
  };
  const colors = scale.colors(clusters.length + 1);
  clusters.forEach((_ref4, i) => {
    let name = _ref4.name,
        childs = _ref4.childs;
    const color = colors[i + 1];
    const id = nextID();
    const cluster = [];
    const clusterName = `cluster_${id}`;
    clusterRoots.colors[clusterName] = color;
    cluster.push(`  subgraph ${clusterName} {`);
    cluster.push(`    style="rounded,bold";`);
    cluster.push(`    color="${color}";`);
    cluster.push(`    node [fontcolor="${color}",fontsize="25px"];`);
    childs.forEach(childName => {
      freeNodes.delete(childName);
      const id = nameMap.idOf[childName];
      clusterRoots.clusterOf[id] = clusterName;
      let visibleName = '/';

      if (childName !== name) {
        visibleName = childName.slice(name.length + 1);
      } else {
        clusterRoots.roots.add(id);
        clusterRoots.map[id] = clusterName;
      }

      cluster.push(`    ${id} [label="${visibleName}",group="${name}"];`);
    });
    cluster.push(`    fontcolor="${color}";`);
    cluster.push(`    fontsize="45px";`);
    cluster.push(`    label = "${name}";`);
    cluster.push(`  }`);
    results.push(...cluster);
  });
  freeNodes.forEach(name => {
    results.push(`  ${nameMap.idOf[name]} [label="${name}"];`);
  });
  links.forEach((_ref5) => {
    let from = _ref5.from,
        to = _ref5.to;
    const fromId = nameMap.idOf[from];
    const toId = nameMap.idOf[to];
    let opts = ' [style="dashed"]';
    const sameCluster = toId in clusterRoots.clusterOf && clusterRoots.clusterOf[fromId] === clusterRoots.clusterOf[toId];

    if (sameCluster) {
      const cluster = clusterRoots.clusterOf[fromId];
      const color = clusterRoots.colors[cluster];
      opts = ` [style="bold",color="${color}"]`;
    } else if (clusterRoots.roots.has(toId)) {
      opts = ` [style="dashed",lhead=${clusterRoots.map[toId]}]`;
    }

    results.push(`  ${fromId} -> ${toId}${opts};`);
  });
  results.push('}');
  const fullText = results.join(`\n`); // console.log('path', Path.resolve(process.cwd(), output))
  // console.log('moduleSet', moduleSet)
  // console.log('nameMap', nameMap)
  // console.log('clustersFirst', clustersFirst)
  // console.log('clusters', clusters)

  if (nameMap.names.length === 0) {
    console.log('[moduleGraphGenerator] no modules given, return without writing results');
    return;
  }

  const outputPath = Path.resolve(process.cwd(), output);
  fs.outputFileSync(outputPath, fullText);
  console.log('[moduleGraphGenerator] module dependency scheme saved to file %s', outputPath);
}

function prune(modules) {
  const avail = modules.filter(m => m.deps.length == 0);

  if (!avail.length) {
    return;
  }

  const id = avail[0].id;
  const index = modules.indexOf(avail[0]);
  modules.splice(index, 1);
  modules.forEach(m => {
    m.deps = m.deps.filter(dep => dep != id);
  });
  prune(modules);
}

function getPrefix(ids) {
  if (ids.length < 2) {
    return '';
  }

  return ids.reduce((prefix, val) => {
    while (val.indexOf(prefix) != 0) {
      prefix = prefix.substring(0, prefix.length - 1);
    }

    return prefix;
  });
}

function plugin(options) {
  if (options === void 0) {
    options = {};
  }

  const exclude = str => options.exclude && str.match(options.exclude);

  return {
    generateBundle(bundleOptions, bundle, isWrite) {
      const ids = [];

      for (const moduleId of this.moduleIds) {
        if (!exclude(moduleId)) {
          ids.push(moduleId);
        }
      }

      const prefix = getPrefix(ids);

      const strip = str => str.substring(prefix.length);

      const modules = [];
      ids.forEach(id => {
        const m = {
          id: strip(id),
          deps: this.getModuleInfo(id).importedIds.filter(x => !exclude(x)).map(strip)
        };

        if (exclude(m.id)) {
          return;
        }

        modules.push(m);
      });

      if (Boolean(options.prune)) {
        prune(modules);
      }

      toDot(modules, options.output);
    }

  };
}

var name = "effector-dev";
var version = "0.18.0";
var description = "Reactive state manager";
var typings = "index.d.ts";
var scripts = {
	docs: "docsify serve .",
	"build:bs": "bsb -make-world",
	server: "micro",
	test: "npx jest --config=jest.config.js",
	bench: "node --expose-gc bench/bench.test.js",
	perfsnake: "npx parcel serve --no-hmr --no-autoinstall tools/perfsnake/index.html",
	"prepublish:all": "npm run build",
	"prepublish:next": "npm run build",
	"publish:all": "node scripts/publish.js",
	"publish:next": "NEXT='true' node scripts/publish.js",
	build: "yarn build:builder && yarn builder",
	"build:builder": "npx rollup -c tools/builder/rollup.config.js",
	builder: "node tools/builder.js",
	"builder:watch": "npx nodemon -w tools/builder/ -w src -i tools/builder.js -x 'yarn build'",
	postinstall: "yarn build:builder",
	"test:watch": "npx jest --config=jest.config.js --watch",
	repack: "npx prepack 'npm/effector/effector.bundle.js' --inlineExpressions --compatibility browser --out 'npm/effector/effector.prepack-bundle.js'"
};
var author = "Zero Bias";
var license = "MIT";
var devDependencies = {
	"@babel/cli": "^7.2.3",
	"@babel/core": "^7.2.2",
	"@babel/node": "^7.2.2",
	"@babel/plugin-proposal-async-generator-functions": "^7.2.0",
	"@babel/plugin-proposal-class-properties": "^7.2.3",
	"@babel/plugin-proposal-decorators": "^7.2.3",
	"@babel/plugin-proposal-export-namespace-from": "^7.2.0",
	"@babel/plugin-proposal-nullish-coalescing-operator": "^7.2.0",
	"@babel/plugin-proposal-object-rest-spread": "^7.2.0",
	"@babel/plugin-proposal-optional-chaining": "^7.2.0",
	"@babel/plugin-transform-block-scoping": "^7.2.0",
	"@babel/plugin-transform-flow-comments": "^7.2.0",
	"@babel/plugin-transform-flow-strip-types": "^7.2.3",
	"@babel/plugin-transform-for-of": "^7.2.0",
	"@babel/plugin-transform-modules-commonjs": "^7.2.0",
	"@babel/preset-env": "^7.2.3",
	"@babel/preset-flow": "^7.0.0",
	"@babel/preset-react": "^7.0.0",
	"@babel/register": "^7.0.0",
	"babel-core": "7.0.0-bridge.0",
	"babel-eslint": "^10.0.1",
	"babel-jest": "^23.6.0",
	"babel-plugin-dev-expression": "^0.2.1",
	"babel-plugin-macros": "^2.4.5",
	"babel-plugin-module-resolver": "^3.1.2",
	"babel-plugin-transform-inline-environment-variables": "^0.4.3",
	"bs-platform": "^4.0.18",
	chalk: "^2.4.2",
	chokidar: "^2.0.4",
	"chroma-js": "^2.0.2",
	"codegen.macro": "^3.0.0",
	connect: "^3.6.6",
	"cross-env": "^5.2.0",
	"cross-fetch": "^3.0.0",
	"docsify-cli": "^4.3.0",
	enzyme: "^3.8.0",
	"enzyme-adapter-react-16": "^1.7.1",
	eslint: "^5.12.0",
	"eslint-plugin-babel": "^5.3.0",
	"eslint-plugin-flowtype": "^3.2.1",
	"eslint-plugin-jest": "^22.1.3",
	"eslint-plugin-react": "^7.12.4",
	execa: "^1.0.0",
	express: "^4.16.4",
	fastify: "^1.13.3",
	"fastify-babel": "^1.1.0",
	"fastify-favicon": "^0.3.0",
	"flow-bin": "^0.91.0",
	"flow-copy-source": "^2.0.2",
	flowgen: "^1.3.0",
	"fs-extra": "^7.0.1",
	graphlib: "^2.1.7",
	immer: "^1.10.5",
	immutable: "^4.0.0-rc.12",
	jest: "^23.6.0",
	"jest-enzyme": "^7.0.1",
	"jest-runner-eslint": "^0.7.1",
	"js-yaml": "^3.12.1",
	jscodeshift: "^0.6.2",
	jsdom: "^13.1.0",
	"jsdom-global": "^3.0.2",
	micro: "^9.3.3",
	"micro-dev": "^3.0.0",
	most: "^1.7.3",
	nodemon: "^1.18.9",
	now: "^13.1.2",
	"parcel-bundler": "^1.11.0",
	prepack: "^0.2.54",
	prettier: "^1.15.3",
	"prettier-eslint": "^8.8.2",
	"prettier-eslint-cli": "^4.7.1",
	"pretty-hrtime": "^1.0.3",
	puppeteer: "^1.11.0",
	raf: "^3.4.1",
	react: "^16.7.0",
	"react-dom": "^16.7.0",
	"react-test-renderer": "^16.7.0",
	"reason-react": "^0.5.3",
	redux: "^4.0.1",
	rimraf: "^2.6.2",
	rollup: "^1.1.0",
	"rollup-plugin-babel": "^4.3.0",
	"rollup-plugin-bucklescript": "^0.7.0",
	"rollup-plugin-commonjs": "^9.2.0",
	"rollup-plugin-json": "^3.1.0",
	"rollup-plugin-node-builtins": "^2.1.2",
	"rollup-plugin-node-globals": "^1.4.0",
	"rollup-plugin-node-resolve": "^4.0.0",
	"rollup-plugin-replace": "^2.1.0",
	"rollup-plugin-size-snapshot": "^0.8.0",
	"rollup-plugin-terser": "^4.0.2",
	"rollup-plugin-visualizer": "^0.9.2",
	serve: "^10.1.1",
	setimmediate: "^1.0.5",
	shelljs: "^0.8.3",
	"styled-components": "^4.1.3",
	terser: "^3.14.1",
	vue: "^2.5.22"
};
var maintainers = [
	{
		name: "Zero Bias",
		email: "ribkatt@gmail.com"
	},
	{
		name: "goodmind",
		email: "andwebar@gmail.com"
	}
];
var repository = "https://github.com/zerobias/effector";
var dependencies = {
	"symbol-observable": "^1.2.0"
};
var alias = {
	warning: "./src/warning/index.js",
	invariant: "./src/invariant/index.js",
	effector: "./src/index.js",
	"effector-react": "./src/react",
	"effector-vue": "./src/vue",
	"effector/domain": "./src/domain",
	"effector/effect": "./src/effect",
	"effector/event": "./src/event",
	"effector/store": "./src/store",
	"effector/graphite": "./src/graphite",
	"effector/graphite/tarjan": "./src/graphite/tarjan",
	"effector/graphite/typedef": "./src/graphite/typedef",
	"effector/stdlib/fx": "./src/stdlib/fx",
	"effector/stdlib/kind": "./src/stdlib/kind",
	"effector/stdlib/typedef": "./src/stdlib/typedef",
	"effector/stdlib/stateref": "./src/stdlib/stateref",
	"effector/stdlib/iterator": "./src/stdlib/iterator",
	"effector/flags": "./src/flags.prod",
	"effector/perf": "./src/perf"
};
var packageJson = {
	name: name,
	version: version,
	description: description,
	typings: typings,
	"private": true,
	scripts: scripts,
	author: author,
	license: license,
	devDependencies: devDependencies,
	maintainers: maintainers,
	repository: repository,
	dependencies: dependencies,
	alias: alias
};

const root = process.cwd();
function dir() {
  for (var _len = arguments.length, paths = new Array(_len), _key = 0; _key < _len; _key++) {
    paths[_key] = arguments[_key];
  }

  return Path.resolve(root, ...paths);
}
async function outputPackageJSON(path, config) {
  let fullPath;
  if (path.endsWith('package.json')) fullPath = dir(path);else fullPath = dir(path, 'package.json');
  await fs.outputJSON(fullPath, config, {
    spaces: 2
  });
}
function massCopy(from, to, targets) {
  const jobs = [];

  for (const target of targets) {
    if (typeof target === 'string') {
      jobs.push([dir(from, target), dir(to, target)]);
    } else {
      const fromFile = target[0],
            toFile = target[1];

      if (typeof toFile === 'string') {
        jobs.push([dir(from, fromFile), dir(to, toFile)]);
      } else {
        for (const toFileName of toFile) {
          jobs.push([dir(from, fromFile), dir(to, toFileName)]);
        }
      }
    }
  }

  return Promise.all(jobs.map((_ref) => {
    let from = _ref[0],
        to = _ref[1];
    return fs.copy(from, to);
  }));
}
function taskList(_ref2) {
  let tasks = _ref2.tasks,
      hooks = _ref2.hooks;
  const pending = [];

  const run = tasks => tasks.reduce((p, task) => p.then(task), Promise.resolve());

  return run(hooks.beforeAll).then(() => {
    for (const pkg in tasks) {
      if (pkg === 'beforeAll') continue;
      pending.push(run(tasks[pkg]));
    }

    return Promise.all(pending);
  });
}
/* eslint-disable max-len */

/**
 * @example ../../src/react/createComponent.js -> node_modules/effector-react/createComponent.js
 */

const getSourcemapPathTransform = name$$1 => function sourcemapPathTransform(relativePath) {
  let packagePath = Path.join('../..', packageJson.alias[name$$1]);

  if (Path.extname(packagePath) !== '') {
    packagePath = Path.dirname(packagePath);
  }

  return Path.join(`node_modules/${name$$1}`, Path.relative(packagePath, relativePath));
};

const minifyConfig = (_ref) => {
  let prettify = _ref.prettify;
  return {
    ecma: 8,
    mangle: {
      toplevel: true,
      module: true,
      reserved: ['effector', 'effectorVue', 'effectorReact', 'it']
    },
    compress: {
      pure_getters: true
    },
    output: prettify ? {
      comments: /#/i,
      beautify: true,
      indent_level: 2
    } : {
      comments: /#/i
    }
  };
};

const getPlugins = () => ({
  babel: babel({// runtimeHelpers: true,
    // exclude: /(\.re|node_modules.*)/,
  }),
  replace: replace({
    'process.env.NODE_ENV': JSON.stringify('production')
  }),
  commonjs: commonjs({}),
  resolve: resolve({}),
  terser: rollupPluginTerser.terser(minifyConfig({
    prettify: !!process.env.PRETTIFY
  })),
  sizeSnapshot: rollupPluginSizeSnapshot.sizeSnapshot(),
  graph: plugin({
    output: 'modules.dot'
  })
});

async function rollupEffector() {
  const name = 'effector';
  await Promise.all([cjsAndEs(), umd()]);

  async function cjsAndEs() {
    const plugins = getPlugins();
    const build = await rollup.rollup({
      input: dir(`packages/${name}/index.js`),
      external: ['warning', 'invariant', 'react', 'vue', 'most', 'symbol-observable', 'effector'],
      plugins: [plugins.resolve, plugins.babel, plugins.graph, plugins.terser, plugins.sizeSnapshot]
    });
    await Promise.all([build.write({
      file: dir(`npm/${name}/${name}.cjs.js`),
      format: 'cjs',
      name,
      sourcemap: true,
      sourcemapPathTransform: getSourcemapPathTransform(name)
    }), build.write({
      file: dir(`npm/${name}/${name}.es.js`),
      format: 'es',
      name,
      sourcemap: true,
      sourcemapPathTransform: getSourcemapPathTransform(name)
    })]);
  }

  async function umd() {
    const plugins = getPlugins(); //$off

    const build = await rollup.rollup({
      input: String(dir(`packages/${name}/index.js`)),
      plugins: [plugins.resolve, plugins.babel, plugins.replace, plugins.commonjs, plugins.terser, plugins.sizeSnapshot],
      external: ['react', 'effector']
    });
    await build.write({
      file: dir(`npm/${name}/${name}.bundle.js`),
      format: 'iife',
      name,
      sourcemap: true
    });
  }
}
async function rollupEffectorReact() {
  const name = 'effector-react';
  await Promise.all([cjsAndEs(), umd()]);

  async function cjsAndEs() {
    const plugins = getPlugins();
    const build = await rollup.rollup({
      input: dir(`packages/${name}/index.js`),
      external: ['warning', 'invariant', 'react', 'vue', 'most', 'symbol-observable', 'effector'],
      plugins: [plugins.resolve, plugins.babel, plugins.terser, plugins.sizeSnapshot]
    });
    await Promise.all([build.write({
      file: dir(`npm/${name}/${name}.cjs.js`),
      format: 'cjs',
      name,
      sourcemap: true,
      sourcemapPathTransform: getSourcemapPathTransform(name)
    }), build.write({
      file: dir(`npm/${name}/${name}.es.js`),
      format: 'es',
      name,
      sourcemap: true,
      sourcemapPathTransform: getSourcemapPathTransform(name)
    })]);
  }

  async function umd() {
    const plugins = getPlugins(); //$off

    const build = await rollup.rollup({
      input: String(dir(`packages/${name}/index.js`)),
      plugins: [plugins.resolve, plugins.babel, plugins.replace, plugins.commonjs, plugins.terser, plugins.sizeSnapshot],
      external: ['react', 'effector']
    });
    await build.write({
      file: dir(`npm/${name}/${name}.bundle.js`),
      format: 'iife',
      name: 'effectorReact',
      sourcemap: true
    });
  }
}
async function rollupEffectorVue() {
  const name = 'effector-vue';
  await Promise.all([cjsAndEs(), umd()]);

  async function cjsAndEs() {
    const plugins = getPlugins();
    const build = await rollup.rollup({
      input: dir(`packages/${name}/index.js`),
      external: ['warning', 'invariant', 'react', 'vue', 'most', 'symbol-observable', 'effector'],
      plugins: [plugins.resolve, plugins.babel, plugins.terser, plugins.sizeSnapshot]
    });
    await Promise.all([build.write({
      file: dir(`npm/${name}/${name}.cjs.js`),
      format: 'cjs',
      name,
      sourcemap: true,
      sourcemapPathTransform: getSourcemapPathTransform(name)
    }), build.write({
      file: dir(`npm/${name}/${name}.es.js`),
      format: 'es',
      name,
      sourcemap: true,
      sourcemapPathTransform: getSourcemapPathTransform(name)
    })]);
  }

  async function umd() {
    const plugins = getPlugins(); //$off

    const build = await rollup.rollup({
      input: String(dir(`packages/${name}/index.js`)),
      plugins: [plugins.resolve, plugins.babel, plugins.replace, plugins.commonjs, plugins.terser, plugins.sizeSnapshot],
      external: ['vue', 'effector']
    });
    await build.write({
      file: dir(`npm/${name}/${name}.bundle.js`),
      format: 'iife',
      name: 'effectorVue',
      sourcemap: true
    });
  }
}

const maintainers$1 = [{
  name: 'Zero Bias',
  email: 'ribkatt@gmail.com'
}, {
  name: 'goodmind',
  email: 'andwebar@gmail.com'
}];
const version$1 = {
  effector: '0.18.0',
  'effector-react': '0.18.0',
  'effector-vue': '0.18.0',
  'bs-effector': '0.18.0',
  'bs-effector-react': '0.18.0'
};

const getFiles = name => ['README.md', 'LICENSE', `${name}.es.js`, `${name}.cjs.js`, `${name}.es.js.map`, `${name}.cjs.js.map`, `${name}.cjs.js.flow`, `${name}.es.js.flow`, 'index.d.ts', 'index.js.flow'];

var packages = {
  effector: {
    name: 'effector',
    version: version$1['effector'],
    description: 'Reactive state manager',
    main: 'effector.cjs.js',
    module: 'effector.es.js',
    'jsnext:main': 'effector.es.js',
    typings: 'index.d.ts',
    scripts: {},
    author: 'Zero Bias',
    license: 'MIT',
    devDependencies: {},
    dependencies: {
      'symbol-observable': '^1.2.0'
    },
    maintainers: maintainers$1,
    sideEffects: false,
    files: getFiles('effector'),
    repository: 'https://github.com/zerobias/effector',
    homepage: 'https://zerobias.github.io/effector/',
    engines: {
      node: '>=6.0.0'
    },
    bugs: 'https://github.com/zerobias/effector/issues',
    keywords: ['data', 'datastructure', 'functional', 'collection', 'state', 'store', 'reactive', 'streams', 'actions', 'effects', 'redux']
  },
  'effector-react': {
    name: 'effector-react',
    version: version$1['effector-react'],
    description: 'React bindings for effector',
    main: 'effector-react.cjs.js',
    module: 'effector-react.es.js',
    'jsnext:main': 'effector-react.es.js',
    typings: 'index.d.ts',
    scripts: {},
    author: 'Zero Bias',
    license: 'MIT',
    devDependencies: {},
    dependencies: {
      effector: '^0.18.0'
    },
    peerDependencies: {
      react: '*'
    },
    maintainers: maintainers$1,
    sideEffects: false,
    files: getFiles('effector-react'),
    repository: 'https://github.com/zerobias/effector',
    homepage: 'https://zerobias.github.io/effector/',
    engines: {
      node: '>=6.0.0'
    },
    bugs: 'https://github.com/zerobias/effector/issues',
    keywords: ['data', 'datastructure', 'functional', 'collection', 'state', 'store', 'reactive', 'streams', 'actions', 'effects', 'redux', 'react']
  },
  'effector-vue': {
    name: 'effector-vue',
    version: version$1['effector-vue'],
    description: 'Vue bindings for effector',
    main: 'effector-vue.cjs.js',
    module: 'effector-vue.es.js',
    'jsnext:main': 'effector-vue.es.js',
    typings: 'index.d.ts',
    scripts: {},
    author: 'Zero Bias',
    license: 'MIT',
    devDependencies: {},
    dependencies: {
      effector: '^0.18.0'
    },
    peerDependencies: {
      vue: '*'
    },
    maintainers: maintainers$1,
    sideEffects: false,
    files: getFiles('effector-vue'),
    repository: 'https://github.com/zerobias/effector',
    homepage: 'https://zerobias.github.io/effector/',
    engines: {
      node: '>=6.0.0'
    },
    bugs: 'https://github.com/zerobias/effector/issues',
    keywords: ['data', 'datastructure', 'functional', 'collection', 'state', 'store', 'reactive', 'streams', 'actions', 'effects', 'redux', 'vue']
  },
  'bs-effector': {
    name: 'bs-effector',
    version: version$1['bs-effector'],
    description: 'Reason bindings for effector',
    author: 'Zero Bias',
    license: 'MIT',
    devDependencies: {},
    dependencies: {},
    peerDependencies: {
      effector: '*'
    },
    maintainers: maintainers$1,
    files: ['src/Effector.re', 'bsconfig.json'],
    keywords: ['bucklescript', 'reason', 'bsb', 'data', 'datastructure', 'functional', 'collection', 'state', 'store', 'reactive', 'streams', 'actions', 'effects', 'redux'],
    repository: 'https://github.com/zerobias/effector',
    bugs: 'https://github.com/zerobias/effector/issues'
  },
  'bs-effector-react': {
    name: 'bs-effector-react',
    version: version$1['bs-effector-react'],
    description: 'Reason bindings for effector-react',
    author: 'Zero Bias',
    license: 'MIT',
    devDependencies: {},
    dependencies: {
      effector: '*'
    },
    peerDependencies: {
      'reason-react': '*'
    },
    maintainers: maintainers$1,
    files: ['src/EffectorReact.re', 'bsconfig.json'],
    keywords: ['bucklescript', 'reason', 'bsb', 'data', 'datastructure', 'functional', 'collection', 'state', 'store', 'reactive', 'streams', 'actions', 'effects', 'redux', 'react'],
    repository: 'https://github.com/zerobias/effector',
    bugs: 'https://github.com/zerobias/effector/issues'
  }
};

var bsconfigs = {
  'bs-effector': {
    name: 'bs-effector',
    sources: {
      dir: 'src',
      subdirs: true
    },
    'bsc-flags': ['-bs-no-version-header', '-bs-g'],
    reason: {
      'react-jsx': 2
    },
    'bs-dev-dependencies': [],
    namespace: true,
    refmt: 3
  },
  'bs-effector-react': {
    name: 'bs-effector-react',
    sources: {
      dir: 'src',
      subdirs: true
    },
    'bs-dependencies': ['bs-effector', 'reason-react'],
    'bsc-flags': ['-bs-no-version-header', '-bs-g'],
    reason: {
      'react-jsx': 2
    },
    'bs-dev-dependencies': [],
    namespace: true,
    refmt: 3
  }
};

const publishScript = name => async () => {
  const args = process.argv.slice(2);
  if (args.length < 2) return;
  const command = args.shift();
  const argument = args.shift();

  if (command === 'publish') {
    if (argument === 'next') {
      const _ref = await execa('npm', ['publish', '--tag', 'next'], {
        cwd: `${process.cwd()}/npm/${name}`
      }),
            stdout = _ref.stdout,
            stderr = _ref.stderr;

      console.log(stdout);
      console.error(stderr);
    } else if (argument === 'latest') {
      const _ref2 = await execa('npm', ['publish', '--tag', 'latest'], {
        cwd: `${process.cwd()}/npm/${name}`
      }),
            stdout = _ref2.stdout,
            stderr = _ref2.stderr;

      console.log(stdout);
      console.error(stderr);
    }
  }
};

var tasks_config = taskList({
  tasks: {
    effector: [() => outputPackageJSON('packages/effector/package.json', packages.effector), () => massCopy('.', 'npm/effector', ['LICENSE', 'README.md']), () => massCopy('packages/effector', 'npm/effector', ['index.d.ts', 'package.json', ['index.js.flow', ['index.js.flow', 'effector.cjs.js.flow', 'effector.es.js.flow', 'effector.bundle.js.flow']]]), rollupEffector, publishScript('effector')],
    'effector-react': [() => outputPackageJSON('packages/effector-react/package.json', packages['effector-react']), () => massCopy('.', 'npm/effector-react', ['LICENSE']), () => massCopy('packages/effector-react', 'npm/effector-react', ['index.d.ts', 'README.md', 'package.json', ['index.js.flow', ['index.js.flow', 'effector-react.cjs.js.flow', 'effector-react.es.js.flow', 'effector-react.bundle.js.flow']]]), rollupEffectorReact, publishScript('effector-react')],
    'effector-vue': [() => outputPackageJSON('packages/effector-vue/package.json', packages['effector-vue']), () => massCopy('.', 'npm/effector-vue', ['LICENSE']), () => massCopy('packages/effector-vue', 'npm/effector-vue', ['index.d.ts', 'README.md', 'package.json', ['index.js.flow', ['index.js.flow', 'effector-vue.cjs.js.flow', 'effector-vue.es.js.flow', 'effector-vue.bundle.js.flow']]]), rollupEffectorVue, publishScript('effector-vue')],
    'bs-effector': [() => outputPackageJSON('packages/bs-effector/package.json', packages['bs-effector']), () => fs.outputJSON('packages/bs-effector/bsconfig.json', bsconfigs['bs-effector'], {
      spaces: 2
    }), () => massCopy('.', 'npm/bs-effector', ['LICENSE']), () => massCopy('src/reason', 'npm/bs-effector', [['Effector.re', 'src/Effector.re']]), () => massCopy('packages/bs-effector', 'npm/bs-effector', ['README.md', 'package.json', 'bsconfig.json']), publishScript('bs-effector')],
    'bs-effector-react': [() => outputPackageJSON('packages/bs-effector-react/package.json', packages['bs-effector-react']), () => fs.outputJSON('packages/bs-effector-react/bsconfig.json', bsconfigs['bs-effector-react'], {
      spaces: 2
    }), () => massCopy('.', 'npm/bs-effector-react', ['LICENSE']), () => massCopy('src/reason', 'npm/bs-effector-react', [['EffectorReact.re', 'src/EffectorReact.re']]), () => massCopy('packages/bs-effector-react', 'npm/bs-effector-react', ['README.md', 'package.json', 'bsconfig.json']), publishScript('bs-effector-react')]
  },
  hooks: {
    beforeAll: [() => fs.emptyDir(`${process.cwd()}/npm`)]
  }
});

module.exports = tasks_config;