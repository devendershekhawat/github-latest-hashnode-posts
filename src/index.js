const core = require('@actions/core');
const exec = require('@actions/exec');
const http = require('@actions/http-client');

const HASHNODE_GQL_ENDPOINT = 'https://gql.hashnode.com';

const DEFAULT_README_FILE = './README.md';
const DEFAULT_OPENING_COMMENT = `<!-- HASHNODE_POSTS:START -->`;
const DEFAULT_CLOSING_COMMENT = `<!-- HASHNODE_POSTS:END -->`;
const DEFAULT_MAX_POSTS = 5;
const DEFAULT_COMMIT_MESSAGE = 'Update latest blog posts';

const httpClient = new http.HttpClient('github-action-hashnode-posts');

function getInputs() {
	return {
		hashnodeAccessToken: core.getInput('HASHNODE_ACCESS_TOKEN'),
		gitHubToken: core.getInput('GITHUB_TOKEN'),
		readmeFile: core.getInput('README_FILE') || DEFAULT_README_FILE,
		openingComment: core.getInput('OPENING_COMMENT') || DEFAULT_OPENING_COMMENT,
		closingComment: core.getInput('CLOSING_COMMENT') || DEFAULT_CLOSING_COMMENT,
		maxPosts: +core.getInput('MAX_POSTS') || DEFAULT_MAX_POSTS,
		commitMessage: core.getInput('COMMIT_MESSAGE') || DEFAULT_COMMIT_MESSAGE,
	};
}

async function getLatestHashnodePosts(options) {
	const { hashnodeAccessToken, maxPosts } = options;
	core.info(`Fetching latest ${maxPosts} posts from Hashnode...`);
	const response = await httpClient.post(
		HASHNODE_GQL_ENDPOINT,
		JSON.stringify({
			query: `#graphql
      query LatestPosts($first: Int!) {
        me {
          id
          publications(first: 50) {
            edges {
              node {
                id
                posts(page: 0, perPage: ${maxPosts}) {
                  id
                  title
                  slug
                }
              }
            }
          }
        }
      }
    `,
			variables: {
				first: maxPosts,
			},
		}),
		{
			'Content-Type': 'application/json',
			Authorization: hashnodeAccessToken,
			'hn-trace-app': 'github-action-hashnode-posts',
		},
	);

	if (response.message.statusCode !== 200) {
		throw new Error(`Failed to fetch latest posts from Hashnode. Status code: ${response.message.statusCode}`);
	}

	const body = JSON.parse(await response.readBody());
	const {
		data: { me },
	} = body;

	if (!me) {
		throw new Error('No user found with the given access token');
	}

	core.debug('Latest posts fetched from Hashnode');
	core.debug(JSON.stringify(me, null, 2));

	const posts = me.publications.edges.flatMap((edge) => edge.node.posts.edges.map((edge) => edge.node));

	return posts;
}

async function replaceReadmePosts(posts, options) {
	const { readmeFile, openingComment, closingComment } = options;

	let readmeContent;
	try {
		readmeContent = fs.readFileSync(readmeFile, 'utf-8').split('\n');
	} catch (err) {
		core.setFailed(`Couldn't find the file named ${readmeFile}. Exiting!`);
	}

	let startIdx = readmeContent.findIndex((content) => content.trim() === openingComment);
	if (startIdx === -1) {
		core.setFailed(`Couldn't find the ${openingComment} comment. Exiting!`);
	}

	const endIdx = readmeContent.findIndex((content) => content.trim() === closingComment);
	if (endIdx === -1) {
		core.setFailed(`Couldn't find the ${closingComment} comment. Exiting!`);
	}

	// TODO: replace with a nice formatting
	const content = JSON.stringify(posts, null, 2);
	const contentLines = content.split('\n');

	// Add one since the content needs to be inserted just after the initial comment
	startIdx++;
	contentLines.forEach((line, idx) => readmeContent.splice(startIdx + idx, 0, line));

	// Append <!--RECENT_ACTIVITY:end--> comment
	readmeContent.splice(startIdx + contentLines.length, 0, closingComment);

	// Update README
	fs.writeFileSync(readmeFile, readmeContent.join('\n'));

	// Commit to the remote repository
	try {
		await commitFile(options);
	} catch (err) {
		core.setFailed(err);
	}
}

/**
 * Make a commit.
 *
 * @returns {Promise<void>}
 */
async function commitFile(options) {
	const { readmeFile, commitMessage } = options;

	await exec('git', ['config', '--global', 'user.name', 'GitHub Action Latest Hashnode Posts'], false);
	await exec('git', ['add', readmeFile], false);
	await exec('git', ['pull'], false);
	await exec('git', ['commit', '-m', commitMessage], false);
	await exec('git', ['push'], true);
}

async function run() {
	try {
		const inputs = getInputs();
		const latestPosts = await getLatestHashnodePosts(inputs);
		await replaceReadmePosts(latestPosts, inputs);
	} catch (error) {
		core.setFailed(error.message);
	}
}

run();
