---
layout: index
title: "Muhammad Usman Akram"
---

<div class="content" id="page">
    <div class="container">
	    <div class="blog">
	        <h2>Wolfie.log</h2>
	        <ul>
                <li>
                <a href="https://gist.github.com/usmanakram232/b76672dcbe4a6ea62467#wolfies-list">Aggregated list of tools, I find useful</a>
                </li>
		<li>
		<span>October 12, 2017</span> - <a href="https://gist.github.com/usmanakram232/7d05785e755a5656b64c74ce4b3a11a5">Description of process of resignation under Italian law</a> 
		</li>		
		<li>
		<span>October 16, 2017</span> - <a href="https://gist.github.com/usmanakram232/e8281fa20f371f11fd2ec5fdb98c94e4">Description of process of aquiring German work visa</a>
		</li>
                <li>
                <span>October 28, 2014</span> - <a href="https://gist.github.com/usmanakram232/5cb8746da82fc4f1a992#a-framework-for-efficent-learning">How to learn better: Efficient Learning</a>
                </li>
                <li>
                <span>October 25, 2014</span> - <a href="https://gist.github.com/usmanakram232/a5738ef1f705d2cc0119#zombie-mode--habits">How to learn better: Zombie Mode & Habits</a>
                </li>
                <li>
                <span>October 24, 2014</span> - <a href="https://gist.github.com/usmanakram232/2e82d052170cd6701eb5#chunking">How to learn better: Chunking</a>
                </li>
	        <li>
	        <span>October 09, 2014</span> - <a href="https://gist.github.com/usmanakram232/2f4cdd7cbf1791d735ad">A GIST as an Entry</a>
                </li>
	        {% for log in site.posts %}
	            <li>
	            <span>{{ log.date | date: "%B %e, %Y" }}</span> - <a href="{{ log.url }}">{{ log.title }}</a>
	            </li>
	        {% endfor %}
	        </ul>
	    </div>
      <hr class="featurette-divider">
    </div> <!-- /container -->
</div>
