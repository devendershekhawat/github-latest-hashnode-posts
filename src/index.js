const fs = require('fs');
const core = require('@actions/core');
const { exec } = require('@actions/exec');
const http = require('@actions/http-client');


const DEFAULT_HASHNODE_GQL_ENDPOINT = 'https://gql.hashnode.com';
const DEFAULT_README_FILE = './README.md';
const DEFAULT_OPENING_COMMENT = `<!-- HASHNODE_POSTS:START -->`;
const DEFAULT_CLOSING_COMMENT = `<!-- HASHNODE_POSTS:END -->`;
const DEFAULT_MAX_POSTS = 5;
const DEFAULT_COMMIT_MESSAGE = 'Update latest blog posts';

const httpClient = new http.HttpClient('github-action-hashnode-posts');

function getInputs() {
	const publicationId = core.getInput('HASHNODE_PUBLICATION_ID');
	if (!publicationId) {
		core.setFailed('HASHNODE_PUBLICATION_ID is required');
	}

	core.info(`token: ${core.getInput('GITHUB_TOKEN')}`);

	return {
		publicationId,
		// TODO: this is for testing on other environments; remove this
		hashnodeGqlEndpoint: core.getInput('HASHNODE_GQL_ENDPOINT') || DEFAULT_HASHNODE_GQL_ENDPOINT,
		gitHubToken: core.getInput('GITHUB_TOKEN'),
		readmeFile: core.getInput('README_FILE') || DEFAULT_README_FILE,
		openingComment: core.getInput('OPENING_COMMENT') || DEFAULT_OPENING_COMMENT,
		closingComment: core.getInput('CLOSING_COMMENT') || DEFAULT_CLOSING_COMMENT,
		maxPosts: +core.getInput('MAX_POSTS') || DEFAULT_MAX_POSTS,
		commitMessage: core.getInput('COMMIT_MESSAGE') || DEFAULT_COMMIT_MESSAGE,
	};
}

async function getLatestHashnodePosts(options) {
	const { hashnodeGqlEndpoint, publicationId, maxPosts } = options;
	core.info(`Fetching latest ${maxPosts} posts from Hashnode...`);
	const response = await httpClient.post(
		hashnodeGqlEndpoint,
		JSON.stringify({
			query: `#graphql
				query LatestPosts($id: ObjectId!, $first: Int!) {
					publication(id: $id) {
						id
						posts(first: $first) {
							edges {
								node {
									id
									title
									brief
									publishedAt
									url
									coverImage {
										url
									}
								}
							}
						}
					}
				}
			`,
			variables: {
				id: publicationId,
				first: maxPosts,
			},
		}),
		{
			'Content-Type': 'application/json',
			'hn-trace-app': 'github-action-hashnode-posts',
		},
	);

	if (response.message.statusCode !== 200) {
		throw new Error(`Failed to fetch latest posts from Hashnode. Status code: ${response.message.statusCode}`);
	}

	const body = JSON.parse(await response.readBody());
	const {
		data: { publication },
	} = body;

	if (!publication) {
		core.setFailed(`Could not find a publication with the given id: ${publicationId}`);
	}

	core.debug('Latest posts fetched from Hashnode');
	core.debug(JSON.stringify(publication, null, 2));

	const posts = publication.posts.edges.map((edge) => edge.node);

	return posts;
}

async function replaceReadmePosts(posts, options) {
	const { readmeFile, openingComment, closingComment } = options;

	let readmeContent;
	try {
		readmeContent = fs.readFileSync(readmeFile, 'utf-8');
	} catch (err) {
		core.error(err);
		core.setFailed(`Couldn't find the file named ${readmeFile}. Exiting!`);
	}

	assertCommentExists(openingComment, readmeContent);
	assertCommentExists(closingComment, readmeContent);

	const formattedPosts = formatPosts(posts);
	core.debug('Formatted posts');
	core.debug(formattedPosts);

	const regex = new RegExp(`${openingComment}([\\s\\S]*?)${closingComment}`, 'g');
	const newReadmeContent = readmeContent.replaceAll(regex, `${openingComment}\n${formattedPosts}\n${closingComment}`);
	core.debug('New readme content');
	core.debug(newReadmeContent);

	fs.writeFileSync(readmeFile, newReadmeContent);

	try {
		await commitFile(options);
	} catch (err) {
		core.setFailed(err);
	}
}

function assertCommentExists(comment, readmeContent) {
	if (!readmeContent.includes(comment)) {
		core.setFailed(`Couldn't find the ${comment} comment. Exiting!`);
	}
}

function formatPosts(posts) {
	return `<table>
	${posts
			.map(
				(post) => `<tr>
			<td><img src="${post.coverImage.url}" width="500" height="auto" /></td>
			<td>
				<sup>${new Date(post.publishedAt).toDateString()}</sup><br />
				<b><a href="${post.url}" target="_blank">${post.title}</a></b>
				<p>${post.brief.replaceAll('\n', ' ')}</p>
			</td>
		</tr>`,
			)
			.join('\n')}
</table>`;
}

/**
 * Make a commit.
 *
 * @returns {Promise<void>}
 */
async function commitFile(options) {
	const { readmeFile, commitMessage } = options;

	await exec('git', ['config', '--global', 'user.name', 'GitHub Action Latest Hashnode Posts']);
	await exec('git', ['config', '--global', 'user.email', 'devender.shekhawat0296@gmail.com']);
	await exec('git', ['config', '--global', 'pull.ff', 'true']);
	await exec('git', ['add', readmeFile]);
	await exec('git', ['pull']);
	try {
		await exec('git', ['commit', '-m', commitMessage]);
		await exec('git', ['push']);
	} catch (error) {
		core.debug("Error while committing:", error.message)
		core.warning('No changes to commit');
	}
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
